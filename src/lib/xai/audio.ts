import type { TokenUsage } from "@/lib/pricing";

export const STT_MODEL = "grok-voice-transcribe-2.0";
export const TTS_VOICE = "eve";
export const TTS_LANGUAGE = "es-MX";
export const STT_LANGUAGE = "es";

type EnvLike = Record<string, string | undefined>;

export function xaiNetworkEnabled(env: EnvLike = process.env) {
  const apiKey = env.XAI_API_KEY?.trim() ?? "";
  return Boolean(apiKey) && (env.XAI_MODE ?? "").trim() !== "mock";
}

function audioBaseUrl(env: EnvLike) {
  return (env.XAI_API_URL?.trim() || "https://api.x.ai/v1").replace(/\/$/, "");
}

export function audioMeterTokens(input: { durationSec?: number; characters: number }): TokenUsage {
  const seconds = Number.isFinite(input.durationSec) ? Math.max(0, input.durationSec ?? 0) : 0;
  const characters = Math.max(0, input.characters);
  return {
    inputTokens: Math.max(1, Math.round(seconds * 50 + characters / 8)),
    cachedTokens: 0,
    outputTokens: Math.max(1, Math.round(characters / 4)),
  };
}

export function silenceWav() {
  const sampleRate = 8000;
  const samples = 1600;
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}

type RecordMeter = (input: { model: string; tokens: TokenUsage }) => Promise<unknown>;

export async function transcribeWithXai(input: {
  apiKey: string;
  baseUrl: string;
  audio: Blob;
  filename: string;
  fetchImpl?: typeof fetch;
}) {
  const form = new FormData();
  form.append("model", STT_MODEL);
  form.append("language", STT_LANGUAGE);
  form.append("format", "true");
  form.append("file", input.audio, input.filename);
  const response = await (input.fetchImpl ?? fetch)(`${input.baseUrl}/stt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: form,
  });
  if (!response.ok) throw new Error("stt");
  const body = (await response.json()) as { text?: unknown; duration?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error("stt");
  const durationSec = typeof body.duration === "number" && Number.isFinite(body.duration) ? body.duration : 0;
  return { text, durationSec };
}

export async function proxySpeechToText(input: {
  audio: Blob;
  filename: string;
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  record?: RecordMeter;
}) {
  const env = input.env ?? process.env;
  const apiKey = env.XAI_API_KEY?.trim() ?? "";
  if (!xaiNetworkEnabled(env)) return Response.json({ ok: false, fallback: true });
  try {
    const result = await transcribeWithXai({
      apiKey,
      baseUrl: audioBaseUrl(env),
      audio: input.audio,
      filename: input.filename,
      fetchImpl: input.fetchImpl,
    });
    await input.record?.({
      model: STT_MODEL,
      tokens: audioMeterTokens({ durationSec: result.durationSec, characters: result.text.length }),
    });
    return Response.json({ ok: true, texto: result.text });
  } catch {
    return Response.json({ ok: false, fallback: true });
  }
}

export function ttsRequestBody(text: string) {
  return {
    text,
    voice_id: TTS_VOICE,
    language: TTS_LANGUAGE,
    optimize_streaming_latency: 1,
  };
}

export async function proxySpeech(input: {
  text: string;
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  record?: RecordMeter;
}) {
  const text = input.text.trim().slice(0, 4000);
  if (!text) return Response.json({ error: "datos" }, { status: 400 });
  const env = input.env ?? process.env;
  const apiKey = env.XAI_API_KEY?.trim() ?? "";
  if (!xaiNetworkEnabled(env)) return Response.json({ ok: false, fallback: true });
  try {
    const response = await (input.fetchImpl ?? fetch)(`${audioBaseUrl(env)}/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ttsRequestBody(text)),
    });
    if (!response.ok || !response.body) throw new Error("tts");
    await input.record?.({
      model: "grok-tts",
      tokens: audioMeterTokens({ characters: text.length }),
    });
    const headers = new Headers();
    headers.set("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { headers });
  } catch {
    return Response.json({ ok: false, fallback: true });
  }
}
