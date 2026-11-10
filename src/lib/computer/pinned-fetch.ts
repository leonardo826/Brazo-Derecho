import http from "node:http";
import https from "node:https";

export function pinnedRequest(input: {
  origin: string;
  pin: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}): Promise<{ status: number; body: string }> {
  const url = new URL(input.origin);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const library = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = library.request(
      {
        host: input.pin,
        port,
        servername: url.hostname,
        method: input.method,
        path: input.path,
        headers: { ...input.headers, host: url.host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk as Buffer));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    const abort = () => request.destroy(new Error("abort"));
    if (input.signal?.aborted) {
      abort();
      reject(Object.assign(new Error("abort"), { name: "AbortError" }));
      return;
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    request.on("error", (error) => {
      input.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    if (input.body) request.write(input.body);
    request.end();
  });
}
