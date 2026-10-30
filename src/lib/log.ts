export type LogValue = string | number | boolean | null;

export function logEvent(event: string, fields: Record<string, LogValue> = {}) {
  console.log(JSON.stringify({ ...fields, ts: new Date().toISOString(), event }));
}
