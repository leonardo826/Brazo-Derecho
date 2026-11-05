"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useCsrfToken } from "@/components/csrf-field";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ACTION_HELP, CHAT_ERROR, type ChatClientEvent, type PublicMessage } from "@/lib/chat/public";
import { replaceOptimisticUser } from "@/lib/chat/thread";
import { hideActionMarker, plainSpeech } from "@/lib/chat/visible";
import { CSRF_HEADER } from "@/lib/csrf-token";
import { ACCOUNTING_DISCLAIMER } from "@/lib/catalog";
import { formatWhen } from "@/lib/format";

type VoiceMode = "xai" | "navegador";
type LocalFile = { file: File; url: string };

type BrowserSpeech = {
  lang: string;
  interimResults: boolean;
  start: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
};

function speechCtor() {
  if (typeof window === "undefined") return null;
  const host = window as Window & {
    SpeechRecognition?: new () => BrowserSpeech;
    webkitSpeechRecognition?: new () => BrowserSpeech;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function listenInBrowser(lang: "es-CL" | "es-ES") {
  const Ctor = speechCtor();
  if (!Ctor) return Promise.reject(new Error("voz"));
  return new Promise<string>((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.onresult = (event) => resolve(event.results[0]?.[0]?.transcript?.trim() ?? "");
    recognition.onerror = () => reject(new Error("voz"));
    recognition.start();
  });
}

function ComposerIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function AttachIcon() {
  return (
    <ComposerIcon>
      <path d="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.1a2 2 0 01-2.8-2.8l8.5-8.5" />
    </ComposerIcon>
  );
}

function MicIcon() {
  return (
    <ComposerIcon>
      <path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z" />
      <path d="M19 11a7 7 0 01-14 0M12 18v3" />
    </ComposerIcon>
  );
}

function StopIcon() {
  return (
    <ComposerIcon>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
    </ComposerIcon>
  );
}

function SendIcon() {
  return (
    <ComposerIcon>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </ComposerIcon>
  );
}

const autoplayListeners = new Set<() => void>();

function autoplayNow() {
  return window.localStorage.getItem("bd-leer-respuestas") === "1";
}

function setStoredAutoplay(value: boolean) {
  window.localStorage.setItem("bd-leer-respuestas", value ? "1" : "0");
  for (const listener of autoplayListeners) listener();
}

function subscribeAutoplay(listener: () => void) {
  autoplayListeners.add(listener);
  return () => autoplayListeners.delete(listener);
}

function speakLocal(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-CL";
  window.speechSynthesis.speak(utterance);
  return true;
}

async function readEvents(response: Response, onEvent: (event: ChatClientEvent) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ia");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      onEvent(JSON.parse(data) as ChatClientEvent);
    }
  }
}

export function AgentChat({
  open,
  messages,
  used,
  limit,
  voice,
}: {
  open: boolean;
  messages: PublicMessage[];
  used: number;
  limit: number;
  voice: VoiceMode;
}) {
  const router = useRouter();
  const csrf = useCsrfToken();
  const [items, setItems] = useState(messages);
  const [composer, setComposer] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [live, setLive] = useState("");
  const [notice, setNotice] = useState("");
  const [consults, setConsults] = useState(used);
  const [recording, setRecording] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(voice);
  const autoplay = useSyncExternalStore(subscribeAutoplay, autoplayNow, () => false);
  const [speakingId, setSpeakingId] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stopRecord = useRef<(() => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tempId = useRef("");

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [items, live, status, pending]);

  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 112)}px`;
  }, [composer]);

  function upsert(message: PublicMessage, localId = "") {
    setItems((prev) => replaceOptimisticUser(prev, message, localId));
  }

  function apply(event: ChatClientEvent) {
    if (event.type === "status") setStatus(event.text);
    if (event.type === "user") {
      // El updater de React corre después de este turno. Si el id temporal se lee ahí,
      // el ref ya está vacío y la burbuja optimista queda junto a la guardada.
      const localId = tempId.current;
      tempId.current = "";
      upsert(event.message, localId);
    }
    if (event.type === "delta") {
      setLive((current) => hideActionMarker(current + event.text));
      setStatus("escribiendo…");
    }
    if (event.type === "message") {
      setLive("");
      upsert(event.message);
    }
    if (event.type === "replace") upsert(event.message);
    if (event.type === "usage") setConsults(event.consults);
    if (event.type === "error") {
      setNotice(CHAT_ERROR[event.code] ?? CHAT_ERROR.ia);
      setLive("");
      setStatus("");
    }
    if (event.type === "done") {
      setPending(false);
      setStatus("");
      setLive("");
      router.refresh();
    }
  }

  async function consume(response: Response, restore: () => void) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/event-stream")) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setNotice(CHAT_ERROR[body.error ?? ""] ?? CHAT_ERROR.ia);
      restore();
      setPending(false);
      setStatus("");
      return true;
    }
    let lastAssistant = "";
    let lastId = "";
    await readEvents(response, (event) => {
      apply(event);
      if (event.type === "message" && event.message.role === "ASSISTANT" && event.message.kind === "TEXT") {
        lastAssistant = event.message.body;
        lastId = event.message.id;
      }
      if (event.type === "done" && autoplayNow() && lastAssistant) void play(lastAssistant, lastId);
    });
    setPending(false);
    return false;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !open) return;
    const text = composer.trim();
    const chosen = files;
    if (!text && chosen.length === 0) return;
    const snapshot = composer;
    const id = `local-${crypto.randomUUID()}`;
    tempId.current = id;
    setNotice("");
    setPending(true);
    setStatus("Revisando…");
    setLive("");
    setItems((prev) => [
      ...prev,
      {
        id,
        role: "USER",
        kind: "TEXT",
        body: text,
        action: "",
        actionTitle: "",
        confirmation: null,
        createdAt: new Date().toISOString(),
        attachments: chosen.map((item, index) => ({
          id: `${id}-${index}`,
          fileName: item.file.name,
          mimeType: item.file.type || "application/octet-stream",
          sizeBytes: item.file.size,
        })),
      },
    ]);
    setComposer("");
    setFiles([]);
    const form = new FormData();
    form.set("agente", "ACCOUNTING");
    form.set("texto", text);
    for (const item of chosen) form.append("archivo", item.file);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { [CSRF_HEADER]: csrf },
        body: form,
      });
      const kept = await consume(response, () => {
        tempId.current = "";
        setItems((prev) => prev.filter((item) => item.id !== id));
        setComposer(snapshot);
        setFiles(chosen);
      });
      if (!kept) {
        for (const item of chosen) {
          if (item.url) URL.revokeObjectURL(item.url);
        }
      }
    } catch {
      tempId.current = "";
      setItems((prev) => prev.filter((item) => item.id !== id));
      setComposer(snapshot);
      setFiles(chosen);
      setNotice(CHAT_ERROR.ia);
      setPending(false);
      setStatus("");
    }
  }

  async function decide(id: string, decision: "APPROVED" | "CANCELED") {
    if (pending || !open) return;
    setNotice("");
    setPending(true);
    setStatus(decision === "APPROVED" ? "Revisando…" : "");
    setLive("");
    try {
      const response = await fetch("/api/chat/confirmacion", {
        method: "POST",
        headers: { "Content-Type": "application/json", [CSRF_HEADER]: csrf },
        body: JSON.stringify({ id, decision }),
      });
      await consume(response, () => undefined);
    } catch {
      setNotice(CHAT_ERROR.ia);
      setPending(false);
      setStatus("");
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((current) => {
      const next = [...current];
      for (const file of Array.from(list)) {
        if (next.length >= 4) break;
        const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
        next.push({ file, url });
      }
      return next;
    });
  }

  function removeFile(index: number) {
    setFiles((current) => {
      const next = current.slice();
      const [removed] = next.splice(index, 1);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return next;
    });
  }

  async function transcribeBrowser() {
    try {
      const text = await listenInBrowser("es-CL");
      if (text) setComposer((current) => (current ? `${current} ${text}` : text));
      return;
    } catch {
      try {
        const text = await listenInBrowser("es-ES");
        if (text) setComposer((current) => (current ? `${current} ${text}` : text));
      } catch {
        setNotice(CHAT_ERROR.voz);
      }
    }
  }

  async function toggleMic() {
    if (recording) {
      stopRecord.current?.();
      return;
    }
    setNotice("");
    if (voiceMode === "navegador") {
      setRecording(true);
      await transcribeBrowser();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceMode("navegador");
      setRecording(true);
      await transcribeBrowser();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (clip) => {
        if (clip.data.size) chunks.push(clip.data);
      };
      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        };
      });
      stopRecord.current = () => recorder.stop();
      recorder.start();
      setRecording(true);
      const blob = await stopped;
      setRecording(false);
      const form = new FormData();
      form.set("audio", blob, "nota.webm");
      const response = await fetch("/api/voz/stt", {
        method: "POST",
        headers: { [CSRF_HEADER]: csrf },
        body: form,
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; texto?: string; fallback?: boolean; error?: string };
      if (body.ok && body.texto) {
        setComposer((current) => (current ? `${current} ${body.texto}` : body.texto ?? ""));
        return;
      }
      if (body.fallback || !response.ok) {
        setVoiceMode("navegador");
        setNotice("No pude transcribir en el servidor. Habla de nuevo: uso el micrófono del navegador.");
        setRecording(true);
        await transcribeBrowser();
        setRecording(false);
        return;
      }
      setNotice(CHAT_ERROR[body.error ?? ""] ?? CHAT_ERROR.voz);
    } catch {
      setRecording(false);
      setNotice(CHAT_ERROR.voz);
    }
  }

  async function play(text: string, id: string) {
    const spoken = plainSpeech(text);
    if (!spoken) return;
    if (speakingId === id) {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      setSpeakingId("");
      return;
    }
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    setSpeakingId(id);
    if (voiceMode === "navegador") {
      if (!speakLocal(spoken)) setNotice(CHAT_ERROR.voz);
      setSpeakingId("");
      return;
    }
    try {
      const response = await fetch("/api/voz/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", [CSRF_HEADER]: csrf },
        body: JSON.stringify({ texto: spoken }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json") || !response.ok) {
        const body = (await response.json().catch(() => ({}))) as { fallback?: boolean };
        if (body.fallback) {
          setVoiceMode("navegador");
          if (!speakLocal(spoken)) setNotice(CHAT_ERROR.voz);
        } else setNotice(CHAT_ERROR.voz);
        setSpeakingId("");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setSpeakingId("");
      };
      await audio.play();
    } catch {
      if (!speakLocal(spoken)) setNotice(CHAT_ERROR.voz);
      setSpeakingId("");
    }
  }

  const shownLive = hideActionMarker(live);
  const over = consults >= limit;

  return (
    <section className="agent-chat" aria-label="Conversación con el contador">
      <div className="agent-chat-tools">
        <label className="check">
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(event) => setStoredAutoplay(event.target.checked)}
          />
          Leer las respuestas
        </label>
        <p className="muted agent-chat-hint">En datos móviles queda apagado hasta que lo actives.</p>
      </div>
      <div className="agent-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-busy={pending} aria-label="Mensajes">
        {items.length === 0 && !shownLive ? (
          <p className="muted agent-empty">Escríbeme una duda de IVA, F29 o remuneraciones. El hilo queda guardado en tu empresa.</p>
        ) : null}
        {items.map((message) =>
          message.kind === "CONFIRMATION" ? (
            <article className="confirm-card" key={message.id}>
              <p className="eyebrow">{message.actionTitle || "Confirmación"}</p>
              <p>{message.body}</p>
              <p className="muted">{ACTION_HELP}</p>
              {message.confirmation === "PENDING" ? (
                <div className="composer-actions">
                  <button className="button" type="button" disabled={pending || !open} onClick={() => decide(message.id, "APPROVED")}>
                    Aprobar
                  </button>
                  <button className="button secondary" type="button" disabled={pending || !open} onClick={() => decide(message.id, "CANCELED")}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <p className="muted">{message.confirmation === "APPROVED" ? "Aprobada. Preparo el borrador." : "Cancelada."}</p>
              )}
            </article>
          ) : (
            <div className={`agent-row ${message.role === "USER" ? "user" : "assistant"}`} key={message.id}>
              <article className={`agent-bubble ${message.role === "USER" ? "user" : "assistant"}`}>
                <p className="who">{message.role === "USER" ? "Tú" : "Agente"}</p>
                {message.role === "ASSISTANT" ? <ChatMarkdown text={message.body} /> : <p className="plain-msg">{message.body}</p>}
                {message.attachments.length > 0 ? (
                  <div className="agent-files">
                    {message.attachments.map((file) =>
                      file.id.startsWith("local-") ? (
                        <span key={file.id}>{file.fileName}</span>
                      ) : file.mimeType.startsWith("image/") ? (
                        <a key={file.id} href={`/api/chat/adjuntos/${file.id}`} target="_blank" rel="noreferrer">
                          {/* La miniatura pide la cookie de sesión; next/image no la manda. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/chat/adjuntos/${file.id}`} alt={file.fileName} />
                        </a>
                      ) : (
                        <a key={file.id} href={`/api/chat/adjuntos/${file.id}`}>
                          {file.fileName}
                        </a>
                      ),
                    )}
                  </div>
                ) : null}
                <p className="muted when">{formatWhen(new Date(message.createdAt))}</p>
                {message.role === "ASSISTANT" ? (
                  <p className="muted disclaimer">{ACCOUNTING_DISCLAIMER}</p>
                ) : null}
                {message.role === "ASSISTANT" && message.body.trim() ? (
                  <button className="button secondary small" type="button" onClick={() => play(message.body, message.id)}>
                    {speakingId === message.id ? "Detener" : "Escuchar"}
                  </button>
                ) : null}
              </article>
            </div>
          ),
        )}
        {pending && !shownLive ? (
          <div className="agent-row assistant">
            <article className="agent-bubble assistant typing">
              <p className="who">Agente</p>
              <p className="typing-status">{status || "escribiendo…"}</p>
            </article>
          </div>
        ) : null}
        {shownLive ? (
          <div className="agent-row assistant">
            <article className="agent-bubble assistant">
              <p className="who">Agente</p>
              <ChatMarkdown text={shownLive} />
              <p className="typing-status">escribiendo…</p>
            </article>
          </div>
        ) : null}
      </div>
      {notice ? (
        <p className="banner error" role="alert">
          {notice}
        </p>
      ) : null}
      {!open ? <p className="muted">Activa la prueba para conversar. El hilo anterior sigue aquí.</p> : null}
      {over ? <p className="muted">Llegaste al cupo de consultas de este mes. Puedes revisar el hilo.</p> : null}
      <form className="agent-composer" onSubmit={onSubmit}>
        {files.length > 0 ? (
          <ul className="file-chips">
            {files.map((item, index) => (
              <li key={`${item.file.name}-${item.file.size}-${index}`}>
                {item.url ? (
                  // Vista previa local del archivo elegido; todavía no está en el servidor.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" />
                ) : null}
                <span>{item.file.name}</span>
                <button type="button" onClick={() => removeFile(index)}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="composer-bar">
          <label className="composer-icon file-button">
            <AttachIcon />
            <span className="sr-only">Adjuntar</span>
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.txt,.csv,.json,application/pdf,text/plain,text/csv,application/json"
              multiple
              disabled={!open || pending}
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <textarea
            ref={composerRef}
            name="texto"
            aria-label="Mensaje"
            value={composer}
            maxLength={4000}
            rows={1}
            placeholder="Escribe tu duda…"
            disabled={!open || pending}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className={`composer-icon${recording ? " recording" : ""}`} type="button" disabled={!open || pending} aria-pressed={recording} onClick={toggleMic}>
            {recording ? <StopIcon /> : <MicIcon />}
            <span className="sr-only">{recording ? "Detener" : "Micrófono"}</span>
          </button>
          <button className="composer-icon send" type="submit" disabled={!open || pending || (!composer.trim() && files.length === 0)}>
            <SendIcon />
            <span className="sr-only">Enviar</span>
          </button>
        </div>
        <p className="composer-note">No compartas claves del SII ni bancarias: esas van en la Bóveda.</p>
      </form>
    </section>
  );
}
