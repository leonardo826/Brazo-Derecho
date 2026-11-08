"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useCsrfToken } from "@/components/csrf-field";
import { ChatMarkdown } from "@/components/chat-markdown";
import { isAbortError } from "@/lib/chat/abort";
import { listenInBrowser } from "@/lib/chat/browser-speech";
import { completeTurn, pushTurn, releasePaused, requeueFront, type TurnEnd, type TurnQueue } from "@/lib/chat/followups";
import { ACTION_HELP, CHAT_ERROR, type ChatClientEvent, type PublicMessage } from "@/lib/chat/public";
import { sealChatText, shouldDropUserText } from "@/lib/chat/secrets";
import { portalPresetFromText, type PortalId } from "@/lib/credentials/portal-form";
import { insertBeforeQueue, placeThreadMessage } from "@/lib/chat/thread";
import { hideActionMarker, plainSpeech } from "@/lib/chat/visible";
import { CSRF_HEADER } from "@/lib/csrf-token";
import { formatWhen } from "@/lib/format";

type VoiceMode = "xai" | "navegador";
type Ear = {
  id: number;
  live: boolean;
  phase: "acquire" | "record" | "stt" | "browser";
  tracks: { stop: () => void }[];
  stopDevice: () => void;
};
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

const DRAFT_PREFIX = "bd-contador-borrador:";

function readDraft(scope: string) {
  try {
    return sessionStorage.getItem(DRAFT_PREFIX + scope) ?? "";
  } catch {
    return "";
  }
}

const draftListeners = new Set<() => void>();

function writeDraft(scope: string, value: string) {
  try {
    const key = DRAFT_PREFIX + scope;
    const current = sessionStorage.getItem(key) ?? "";
    if (current === value) return;
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    return;
  }
  for (const listener of draftListeners) listener();
}

function subscribeDraft(listener: () => void) {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

export function AgentChat({
  open,
  messages,
  used,
  limit,
  voice,
  draftScope = "",
}: {
  open: boolean;
  messages: PublicMessage[];
  used: number;
  limit: number;
  voice: VoiceMode;
  draftScope?: string;
}) {
  const router = useRouter();
  const csrf = useCsrfToken();
  const [items, setItems] = useState(messages);
  const storedDraft = useSyncExternalStore(
    subscribeDraft,
    () => (draftScope ? readDraft(draftScope) : ""),
    () => "",
  );
  const [composer, setComposer] = useState("");
  const [draftSource, setDraftSource] = useState("");
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
  const activeEar = useRef<Ear | null>(null);
  const ears = useRef(new Set<Ear>());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tempId = useRef("");
  const turns = useRef<TurnQueue<Draft>>({ active: null, waiting: [] });
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef("");
  const stopRequestedRef = useRef(false);
  const committedRef = useRef(false);
  const draftText = useRef("");
  if (storedDraft !== draftSource) {
    setDraftSource(storedDraft);
    setComposer(storedDraft);
  }
  const filesRef = useRef<LocalFile[]>([]);
  const mountedRef = useRef(true);
  const turnGen = useRef(0);
  const stickToEnd = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const sawReply = useRef(false);
  const imeGuard = useRef(false);

  useEffect(() => {
    const earsNow = ears.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      for (const ear of earsNow) {
        ear.live = false;
        try {
          ear.stopDevice();
        } catch {
          // El dispositivo ya estaba detenido.
        }
        for (const track of ear.tracks) {
          try {
            track.stop();
          } catch {
            // La pista ya estaba cerrada.
          }
        }
        ear.tracks = [];
      }
      earsNow.clear();
      activeEar.current = null;
      stopRecord.current = null;
    };
  }, []);

  useEffect(() => {
    const node = logRef.current;
    if (node && stickToEnd.current) node.scrollTop = node.scrollHeight;
  }, [items, live, status, pending]);

  useEffect(() => {
    draftText.current = composer;
  }, [composer]);

  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 112)}px`;
  }, [composer]);

  useEffect(() => {
    if (pending) {
      sawReply.current = true;
      return;
    }
    if (!sawReply.current) return;
    const box = composerRef.current;
    if (!box || document.activeElement === box) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && logRef.current?.contains(selection.anchorNode)) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    box.focus({ preventScroll: true });
  }, [pending]);

  function publishQueue() {
    setWaitingIds(turns.current.waiting.map((item) => item.id));
  }

  function updateComposer(value: string) {
    draftText.current = value;
    setComposer(value);
    if (draftScope) writeDraft(draftScope, value);
  }

  function endComposition() {
    imeGuard.current = true;
    window.setTimeout(() => {
      imeGuard.current = false;
    }, 0);
  }

  function updateFiles(next: LocalFile[]) {
    filesRef.current = next;
    setFiles(next);
  }

  function appendComposer(text: string) {
    setComposer((current) => {
      const next = current ? `${current} ${text}` : text;
      draftText.current = next;
      if (draftScope) writeDraft(draftScope, next);
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
    stickToEnd.current = true;
    setStatus(followup ? "Sigo con el siguiente…" : "Preparando respuesta…");
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
    composerRef.current?.focus({ preventScroll: true });
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
    setStatus(decision === "APPROVED" ? "Preparando respuesta…" : "");
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

  function owns(ear: Ear) {
    return ear.live && mountedRef.current && activeEar.current === ear;
  }

  function closeTracks(ear: Ear) {
    for (const track of ear.tracks) {
      try {
        track.stop();
      } catch {
        // La pista ya estaba cerrada.
      }
    }
    ear.tracks = [];
  }

  function releaseEar(ear: Ear) {
    ear.live = false;
    try {
      ear.stopDevice();
    } catch {
      // El dispositivo ya estaba detenido.
    }
    closeTracks(ear);
    ears.current.delete(ear);
    if (activeEar.current === ear) {
      activeEar.current = null;
      stopRecord.current = null;
      if (mountedRef.current) setRecording(false);
    }
  }

  async function transcribeBrowser(ear: Ear) {
    ear.phase = "browser";
    if (mountedRef.current) setRecording(true);
    for (const lang of ["es-CL", "es-ES"] as const) {
      if (!owns(ear)) return;
      const session = listenInBrowser(lang);
      if (!session) continue;
      const stopThis = () => session.stop();
      ear.stopDevice = stopThis;
      stopRecord.current = stopThis;
      if (!owns(ear)) {
        session.stop();
        return;
      }
      try {
        const text = await session.result;
        if (!owns(ear)) return;
        if (text) {
          appendComposer(text);
          return;
        }
      } catch (error) {
        if (!owns(ear)) return;
        const reason = error instanceof Error ? error.message : "";
        if (reason === "abort") return;
        if (reason === "denied") {
          setNotice(CHAT_ERROR.voz);
          return;
        }
      } finally {
        if (stopRecord.current === stopThis) stopRecord.current = null;
      }
    }
    if (owns(ear)) setNotice(CHAT_ERROR.voz);
  }

  async function toggleMic() {
    const current = activeEar.current;
    if (current) {
      if (current.phase === "record") {
        current.phase = "stt";
        try {
          current.stopDevice();
        } catch {
          // La grabación ya estaba cerrada.
        }
        return;
      }
      releaseEar(current);
      return;
    }
    const ear: Ear = { id: ears.current.size + 1, live: true, phase: "acquire", tracks: [], stopDevice: () => {} };
    ears.current.add(ear);
    activeEar.current = ear;
    setNotice("");
    setRecording(true);
    try {
      if (voiceMode === "navegador" || !navigator.mediaDevices?.getUserMedia) {
        await transcribeBrowser(ear);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ear.tracks.push(...stream.getTracks());
      if (!owns(ear)) {
        closeTracks(ear);
        return;
      }
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (clip) => {
        if (clip.data.size) chunks.push(clip.data);
      };
      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        };
      });
      const stopThis = () => {
        try {
          recorder.stop();
        } catch {
          // Ya estaba detenida.
        }
      };
      ear.stopDevice = stopThis;
      stopRecord.current = stopThis;
      ear.phase = "record";
      recorder.start();
      const blob = await stopped;
      closeTracks(ear);
      if (!owns(ear)) return;
      ear.phase = "stt";
      const form = new FormData();
      form.set("audio", blob, "nota.webm");
      const response = await fetch("/api/voz/stt", {
        method: "POST",
        headers: { [CSRF_HEADER]: csrf },
        body: form,
      });
      if (!owns(ear)) return;
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; texto?: string; fallback?: boolean; error?: string };
      if (!owns(ear)) return;
      if (body.ok && body.texto) {
        appendComposer(body.texto);
        return;
      }
      if (body.fallback || !response.ok) {
        if (!owns(ear)) return;
        setVoiceMode("navegador");
        setNotice("No pude transcribir en el servidor. Habla de nuevo: uso el micrófono del navegador.");
        await transcribeBrowser(ear);
        return;
      }
      setNotice(CHAT_ERROR[body.error ?? ""] ?? CHAT_ERROR.voz);
    } catch {
      if (owns(ear)) setNotice(CHAT_ERROR.voz);
    } finally {
      releaseEar(ear);
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
        <article className={`agent-bubble ${message.role === "USER" ? "user" : "assistant"}`} data-message-id={message.id}>
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
      <div
        className="agent-log"
        ref={logRef}
        role="log"
        aria-busy={pending}
        aria-label="Mensajes"
        onScroll={() => {
          const node = logRef.current;
          if (!node) return;
          const near = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
          stickToEnd.current = near;
          setAtEnd(near);
        }}
      >
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
      {atEnd ? null : (
        <button
          className="jump-end"
          type="button"
          onClick={() => {
            const node = logRef.current;
            stickToEnd.current = true;
            setAtEnd(true);
            if (node) node.scrollTop = node.scrollHeight;
          }}
        >
          Volver al final
        </button>
      )}
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
            <span className="sr-only">Adjuntar archivo</span>
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
            placeholder="Escribe al Contador…"
            disabled={!open}
            onChange={(event) => updateComposer(event.target.value)}
            onCompositionEnd={endComposition}
            onKeyDown={(event) => {
              const native = event.nativeEvent;
              if (event.key !== "Enter" || event.shiftKey || native.isComposing || imeGuard.current || native.keyCode === 229) return;
              if (window.matchMedia("(pointer: coarse)").matches) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          <button className={`composer-icon${recording ? " recording" : ""}`} type="button" disabled={!open} aria-pressed={recording} onClick={toggleMic}>
            {recording ? <StopIcon /> : <MicIcon />}
            <span className="sr-only">{recording ? "Detener grabación" : "Micrófono, grabar audio"}</span>
          </button>
          {pending ? (
            <button className="composer-icon stop" type="button" onClick={stopResponse}>
              <StopIcon />
              <span className="sr-only">Detener respuesta</span>
            </button>
          ) : null}
          <button
            className="composer-icon send"
            type="submit"
            disabled={!open || (!composer.trim() && files.length === 0)}
            aria-describedby={pending ? "cola-envio" : undefined}
          >
            <SendIcon />
            <span className="sr-only">Enviar</span>
          </button>
          <span id="cola-envio" className="sr-only" aria-live="polite">
            {pending ? "Hay una respuesta en curso. Enviar deja el mensaje en cola." : ""}
          </span>
        </div>
        <p className="composer-note">No compartas claves del SII ni bancarias: esas van en la Bóveda.</p>
      </form>
    </section>
  );
}
