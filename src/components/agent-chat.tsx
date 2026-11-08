"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useCsrfToken } from "@/components/csrf-field";
import { ChatMarkdown } from "@/components/chat-markdown";
import { isAbortError } from "@/lib/chat/abort";
import { completeTurn, pushTurn, releasePaused, requeueFront, type TurnEnd, type TurnQueue } from "@/lib/chat/followups";
import { ACTION_HELP, CHAT_ERROR, type ChatClientEvent, type PublicMessage } from "@/lib/chat/public";
import { sealChatText, shouldDropUserText } from "@/lib/chat/secrets";
import { portalPresetFromText, type PortalId } from "@/lib/credentials/portal-form";
import { insertBeforeQueue, placeThreadMessage } from "@/lib/chat/thread";
import { hideActionMarker, plainSpeech } from "@/lib/chat/visible";
import { CSRF_HEADER } from "@/lib/csrf-token";
import { ACCOUNTING_DISCLAIMER } from "@/lib/catalog";
import { formatWhen } from "@/lib/format";

type VoiceMode = "xai" | "navegador";
type LocalFile = { file: File; url: string };
type Draft = { id: string; text: string; files: LocalFile[]; portal: PortalId | null };

const STOPPED_NOTE = "Detuviste la respuesta.";

function optimisticUser(draft: Draft): PublicMessage {
  return {
    id: draft.id,
    role: "USER",
    kind: "TEXT",
    body: draft.text,
    action: "",
    actionTitle: "",
    confirmation: null,
    createdAt: new Date().toISOString(),
    attachments: draft.files.map((item, index) => ({
      id: `${draft.id}-${index}`,
      fileName: item.file.name,
      mimeType: item.file.type || "application/octet-stream",
      sizeBytes: item.file.size,
    })),
  };
}

function localAssistant(body: string): PublicMessage {
  return {
    id: `local-stop-${crypto.randomUUID()}`,
    role: "ASSISTANT",
    kind: "TEXT",
    body,
    action: "",
    actionTitle: "",
    confirmation: null,
    createdAt: new Date().toISOString(),
    attachments: [],
  };
}

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
  const [waitingIds, setWaitingIds] = useState<string[]>([]);
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
  const turns = useRef<TurnQueue<Draft>>({ active: null, waiting: [] });
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef("");
  const stopRequestedRef = useRef(false);
  const committedRef = useRef(false);
  const draftText = useRef("");
  const filesRef = useRef<LocalFile[]>([]);
  const mountedRef = useRef(true);
  const turnGen = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

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

  function publishQueue() {
    setWaitingIds(turns.current.waiting.map((item) => item.id));
  }

  function updateComposer(value: string) {
    draftText.current = value;
    setComposer(value);
  }

  function updateFiles(next: LocalFile[]) {
    filesRef.current = next;
    setFiles(next);
  }

  function appendComposer(text: string) {
    setComposer((current) => {
      const next = current ? `${current} ${text}` : text;
      draftText.current = next;
      return next;
    });
  }

  function clearLive() {
    liveRef.current = "";
    setLive("");
  }

  function queuedIds() {
    return turns.current.waiting.map((item) => item.id);
  }

  function remember(message: PublicMessage, localId = "") {
    const queued = queuedIds();
    setItems((prev) => placeThreadMessage(prev, message, localId, queued));
  }

  function pushStopped(body: string) {
    const queued = queuedIds();
    setItems((prev) => insertBeforeQueue(prev, localAssistant(body), queued));
  }

  function freezePartial() {
    if (!mountedRef.current) return;
    const partial = liveRef.current.trim();
    clearLive();
    setStatus("");
    if (committedRef.current) return;
    if (partial) {
      pushStopped(`${partial}\n\n${STOPPED_NOTE}`);
      return;
    }
    if (stopRequestedRef.current) pushStopped(STOPPED_NOTE);
  }

  function apply(event: ChatClientEvent) {
    if (event.type === "status") setStatus(event.text);
    if (event.type === "user") {
      // React runs the updater after this turn. Reading the temp id inside it
      // would see an empty ref and leave the optimistic bubble next to the saved one.
      const localId = tempId.current;
      tempId.current = "";
      remember(event.message, localId);
    }
    if (event.type === "delta") {
      const next = hideActionMarker(liveRef.current + event.text);
      liveRef.current = next;
      setLive(next);
      setStatus("escribiendo…");
    }
    if (event.type === "message") {
      if (event.message.role === "ASSISTANT") committedRef.current = true;
      clearLive();
      remember(event.message);
    }
    if (event.type === "replace") remember(event.message);
    if (event.type === "usage") setConsults(event.consults);
    if (event.type === "error") {
      setNotice(CHAT_ERROR[event.code] ?? CHAT_ERROR.ia);
      clearLive();
      setStatus("");
    }
    if (event.type === "done") {
      committedRef.current = true;
      const more = turns.current.waiting.length > 0 && busyRef.current;
      if (!more) setPending(false);
      setStatus(more ? "Sigo con el siguiente…" : "");
      clearLive();
      router.refresh();
    }
  }

  async function consume(response: Response, signal: AbortSignal, restore: () => void, generation: number) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/event-stream")) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setNotice(CHAT_ERROR[body.error ?? ""] ?? CHAT_ERROR.ia);
      restore();
      setStatus("");
      clearLive();
      return "error" as const;
    }
    let lastAssistant = "";
    let lastId = "";
    let failed = false;
    try {
      await readEvents(response, (event) => {
        if (turnGen.current !== generation) return;
        if (event.type === "error") failed = true;
        apply(event);
        if (event.type === "message" && event.message.role === "ASSISTANT" && event.message.kind === "TEXT") {
          lastAssistant = event.message.body;
          lastId = event.message.id;
        }
        if (event.type === "done" && autoplayNow() && lastAssistant) void play(lastAssistant, lastId);
      });
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return "abort" as const;
      throw error;
    }
    if (signal.aborted || stopRequestedRef.current || turnGen.current !== generation) return "abort" as const;
    if (failed) return "error" as const;
    return "done" as const;
  }

  function takeBack(draft: Draft) {
    tempId.current = "";
    if (draftText.current.trim() || filesRef.current.length > 0) return false;
    if (!draft.text && draft.files.length === 0) return true;
    updateComposer(draft.text);
    updateFiles(draft.files);
    setItems((prev) => prev.filter((item) => item.id !== draft.id));
    return true;
  }

  function revokeFiles(draft: Draft) {
    for (const item of draft.files) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
  }

  async function finishActive(draft: Draft, end: TurnEnd, requeue: boolean) {
    if (!mountedRef.current) return;
    if ((end === "done" || end === "abort") && !requeue) revokeFiles(draft);
    const step = completeTurn(turns.current, end);
    const keep = requeue && (draft.text.length > 0 || draft.files.length > 0);
    turns.current = keep ? requeueFront(step.queue, draft) : step.queue;
    publishQueue();
    if (step.next && !keep) {
      await sendDraft(step.next, true);
      return;
    }
    busyRef.current = false;
    setPending(false);
    setStatus("");
  }

  async function sendDraft(draft: Draft, followup: boolean) {
    const generation = ++turnGen.current;
    stopRequestedRef.current = false;
    committedRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    tempId.current = draft.id;
    setPending(true);
    setNotice("");
    setStatus(followup ? "Sigo con el siguiente…" : "Revisando…");
    clearLive();
    const form = new FormData();
    form.set("agente", "ACCOUNTING");
    form.set("texto", draft.text);
    if (draft.portal) form.set("portal", draft.portal);
    for (const item of draft.files) form.append("archivo", item.file);
    let end: TurnEnd = "error";
    let requeue = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { [CSRF_HEADER]: csrf },
        body: form,
        signal: controller.signal,
      });
      const result = await consume(response, controller.signal, () => {
        requeue = !takeBack(draft);
      }, generation);
      if (result === "abort") {
        freezePartial();
        end = "abort";
      } else if (result === "error") {
        end = "error";
      } else {
        if (!committedRef.current && stopRequestedRef.current) freezePartial();
        end = "done";
      }
    } catch (error) {
      if (!mountedRef.current) return;
      if (isAbortError(error) || controller.signal.aborted) {
        freezePartial();
        end = "abort";
      } else {
        requeue = !takeBack(draft);
        setNotice(CHAT_ERROR.ia);
        clearLive();
        setStatus("");
        end = "error";
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
    await finishActive(draft, end, requeue);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!open) return;
    const raw = composer.trim();
    const drop = shouldDropUserText(raw);
    const text = sealChatText(raw);
    const chosen = drop ? [] : files;
    if (!text && chosen.length === 0) return;
    const draft: Draft = {
      id: `local-${crypto.randomUUID()}`,
      text,
      files: chosen,
      portal: drop ? portalPresetFromText(raw) : null,
    };
    updateComposer("");
    updateFiles([]);
    setNotice("");
    setItems((prev) => [...prev, optimisticUser(draft)]);
    const pushed = pushTurn(turns.current, draft);
    turns.current = pushed.queue;
    publishQueue();
    composerRef.current?.focus({ preventScroll: true });
    if (!pushed.startNow) return;
    busyRef.current = true;
    await sendDraft(draft, false);
  }

  function stopResponse() {
    stopRequestedRef.current = true;
    abortRef.current?.abort();
  }

  function releaseQueue() {
    if (busyRef.current || !open) return;
    const step = releasePaused(turns.current);
    turns.current = step.queue;
    publishQueue();
    if (!step.next) return;
    busyRef.current = true;
    void sendDraft(step.next, true);
  }

  async function decide(id: string, decision: "APPROVED" | "CANCELED") {
    if (busyRef.current || !open) return;
    const sentinel: Draft = { id: `local-decision-${id}`, text: "", files: [], portal: null };
    const pushed = pushTurn(turns.current, sentinel);
    turns.current = pushed.queue;
    if (!pushed.startNow) return;
    busyRef.current = true;
    const generation = ++turnGen.current;
    stopRequestedRef.current = false;
    committedRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice("");
    setPending(true);
    setStatus(decision === "APPROVED" ? "Revisando…" : "");
    clearLive();
    let end: TurnEnd = "error";
    try {
      const response = await fetch("/api/chat/confirmacion", {
        method: "POST",
        headers: { "Content-Type": "application/json", [CSRF_HEADER]: csrf },
        body: JSON.stringify({ id, decision }),
        signal: controller.signal,
      });
      const result = await consume(response, controller.signal, () => undefined, generation);
      if (result === "abort") {
        freezePartial();
        end = "abort";
      } else end = result;
    } catch (error) {
      if (!mountedRef.current) return;
      if (isAbortError(error) || controller.signal.aborted) {
        freezePartial();
        end = "abort";
      } else {
        setNotice(CHAT_ERROR.ia);
        setStatus("");
        clearLive();
        end = "error";
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
    await finishActive(sentinel, end, false);
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
      filesRef.current = next;
      return next;
    });
  }

  function removeFile(index: number) {
    setFiles((current) => {
      const next = current.slice();
      const [removed] = next.splice(index, 1);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      filesRef.current = next;
      return next;
    });
  }

  async function transcribeBrowser() {
    try {
      const text = await listenInBrowser("es-CL");
      if (text) appendComposer(text);
      return;
    } catch {
      try {
        const text = await listenInBrowser("es-ES");
        if (text) appendComposer(text);
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
        appendComposer(body.texto);
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
  const waiting = new Set(waitingIds);
  const settled = items.filter((message) => !waiting.has(message.id));
  const queued = items.filter((message) => waiting.has(message.id));

  function renderMessage(message: PublicMessage) {
    if (message.kind === "CONFIRMATION") {
      return (
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
      );
    }
    const stoppedOnly = message.body.trim() === STOPPED_NOTE;
    return (
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
                    {/* The thumbnail needs the session cookie; next/image does not send it. */}
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
          {waiting.has(message.id) ? <p className="muted when">En espera</p> : null}
          <p className="muted when">{formatWhen(new Date(message.createdAt))}</p>
          {message.role === "ASSISTANT" && !stoppedOnly ? <p className="muted disclaimer">{ACCOUNTING_DISCLAIMER}</p> : null}
          {message.role === "ASSISTANT" && message.body.trim() && !stoppedOnly ? (
            <button className="button secondary small" type="button" onClick={() => play(message.body, message.id)}>
              {speakingId === message.id ? "Detener" : "Escuchar"}
            </button>
          ) : null}
        </article>
      </div>
    );
  }

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
        {settled.map((message) => renderMessage(message))}
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
        {queued.map((message) => renderMessage(message))}
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
        {waitingIds.length > 0 ? (
          <div className="composer-queue">
            <p role="status">{waitingIds.length === 1 ? "1 mensaje en espera" : `${waitingIds.length} mensajes en espera`}</p>
            {!pending ? (
              <button className="button secondary" type="button" onClick={releaseQueue}>
                Enviar en espera
              </button>
            ) : null}
          </div>
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
              disabled={!open}
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
            disabled={!open}
            onChange={(event) => updateComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className={`composer-icon${recording ? " recording" : ""}`} type="button" disabled={!open} aria-pressed={recording} onClick={toggleMic}>
            {recording ? <StopIcon /> : <MicIcon />}
            <span className="sr-only">{recording ? "Detener" : "Micrófono"}</span>
          </button>
          {pending ? (
            <button className="composer-icon stop" type="button" onClick={stopResponse}>
              <StopIcon />
              <span className="sr-only">Detener respuesta</span>
            </button>
          ) : null}
          <button className="composer-icon send" type="submit" disabled={!open || (!composer.trim() && files.length === 0)}>
            <SendIcon />
            <span className="sr-only">Enviar</span>
          </button>
        </div>
        <p className="composer-note">No compartas claves del SII ni bancarias: esas van en la Bóveda.</p>
      </form>
    </section>
  );
}
