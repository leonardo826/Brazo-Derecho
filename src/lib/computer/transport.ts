import { lookup } from "node:dns/promises";
import { isIpAddress, isPrivateAddress } from "@/lib/computer/private-address";
import { pinnedRequest } from "@/lib/computer/pinned-fetch";

export type LookupImpl = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupImpl = (hostname) => lookup(hostname, { all: true, verbatim: true });

export async function revalidatePin(hostname: string, pin: string, lookupImpl?: LookupImpl) {
  if (!isIpAddress(pin) || isPrivateAddress(pin)) return false;
  let records: { address: string }[];
  try {
    records = await (lookupImpl ?? defaultLookup)(hostname);
  } catch {
    return false;
  }
  if (records.length === 0 || records.some((record) => !isIpAddress(record.address) || isPrivateAddress(record.address))) return false;
  return records.some((record) => record.address === pin);
}

function safePath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !path.includes("://");
}

export async function callMachine(input: {
  origin: string;
  pin: string;
  path: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  allowLoopback?: boolean;
  lookupImpl?: LookupImpl;
  fetchImpl?: typeof fetch;
}): Promise<{ status: number; body: string }> {
  if (!safePath(input.path)) throw new Error("transporte");
  let url: URL;
  try {
    url = new URL(input.origin);
  } catch {
    throw new Error("transporte");
  }
  const loopback =
    input.allowLoopback === true && url.protocol === "http:" && url.hostname === "127.0.0.1" && input.pin === "127.0.0.1";
  if (input.fetchImpl) {
    const response = await input.fetchImpl(`${url.origin}${input.path}`, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      redirect: "manual",
      signal: input.signal,
    });
    if (response.status >= 300 && response.status < 400) return { status: response.status, body: "" };
    return { status: response.status, body: await response.text() };
  }
  if (!loopback) {
    if (url.protocol !== "https:") throw new Error("transporte");
    const still = await revalidatePin(url.hostname, input.pin, input.lookupImpl);
    if (!still) throw new Error("transporte");
  }
  const result = await pinnedRequest({
    origin: url.origin,
    pin: input.pin,
    path: input.path,
    method: input.method,
    headers: input.headers,
    body: input.body,
    signal: input.signal,
    allowLoopbackPin: loopback,
  });
  if (result.status >= 300 && result.status < 400) return { status: result.status, body: "" };
  return result;
}
