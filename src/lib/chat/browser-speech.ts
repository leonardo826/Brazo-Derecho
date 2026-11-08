export type BrowserSpeech = {
  lang: string;
  interimResults: boolean;
  start: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function createBrowserSpeech() {
  const Ctor = speechCtor();
  if (!Ctor) return null;
  return new Ctor();
}

export function speechCtor() {
  if (typeof window === "undefined") return null;
  const host = window as Window & {
    SpeechRecognition?: new () => BrowserSpeech;
    webkitSpeechRecognition?: new () => BrowserSpeech;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function speechError(code?: string) {
  if (code === "aborted") return "abort";
  if (code === "not-allowed" || code === "service-not-allowed") return "denied";
  return "voz";
}

/** Empieza una escucha. Al terminar se sueltan los handlers. `stop` cierra aunque el motor no avise. */
export function listenInBrowser(lang: "es-CL" | "es-ES", create: () => BrowserSpeech | null = createBrowserSpeech) {
  const recognition = create();
  if (!recognition) return null;
  recognition.lang = lang;
  recognition.interimResults = false;
  let settled = false;
  const release = () => {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  };
  const finish = (value: string | Error) => {
    if (settled) return;
    settled = true;
    release();
    if (value instanceof Error) rejectRef(value);
    else resolveRef(value);
  };
  let resolveRef: (value: string) => void = () => {};
  let rejectRef: (error: Error) => void = () => {};
  const result = new Promise<string>((resolve, reject) => {
    resolveRef = resolve;
    rejectRef = reject;
    recognition.onresult = (event) => finish(event.results[0]?.[0]?.transcript?.trim() ?? "");
    recognition.onerror = (event) => finish(new Error(speechError(event.error)));
    recognition.onend = () => finish("");
    try {
      recognition.start();
    } catch {
      finish(new Error("voz"));
    }
  });
  return {
    result,
    stop() {
      try {
        recognition.abort();
      } catch {
        // El motor puede no existir. Igual cerramos la espera.
      }
      finish(new Error("abort"));
    },
  };
}
