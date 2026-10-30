import { createHmac } from "node:crypto";

export function flowSignString(params: Record<string, string>) {
  return Object.keys(params)
    .filter((key) => key !== "s")
    .sort()
    .map((key) => key + params[key])
    .join("");
}

export function signFlowParams(params: Record<string, string>, secretKey: string) {
  return createHmac("sha256", secretKey).update(flowSignString(params)).digest("hex");
}
