import http from "node:http";
import https from "node:https";
import { isIpAddress, isPrivateAddress } from "@/lib/computer/private-address";

export const MAX_RESPONSE_BYTES = 64 * 1024;

export function pinnedRequest(input: {
  origin: string;
  pin: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  allowLoopbackPin?: boolean;
}): Promise<{ status: number; body: string }> {
  if (!input.allowLoopbackPin && (!isIpAddress(input.pin) || isPrivateAddress(input.pin))) {
    return Promise.reject(new Error("transporte"));
  }
  const url = new URL(input.origin);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const library = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: { status: number; body: string }) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const request = library.request(
      {
        host: input.pin,
        port,
        family: input.pin.includes(":") ? 6 : 4,
        servername: url.hostname,
        method: input.method,
        path: input.path,
        headers: { ...input.headers, host: url.host },
        rejectUnauthorized: true,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          finish(undefined, { status, body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk) => {
          const buffer = chunk as Buffer;
          size += buffer.length;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy();
            finish(new Error("transporte"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => finish(undefined, { status, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", () => finish(new Error("transporte")));
      },
    );
    const abort = () => {
      request.destroy();
      finish(Object.assign(new Error("abort"), { name: "AbortError" }));
    };
    if (input.signal?.aborted) {
      abort();
      return;
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    request.on("error", () => finish(new Error("transporte")));
    if (input.body) request.write(input.body);
    request.end();
  });
}
