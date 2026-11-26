import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

export const AGENT_KINDS = ["ACCOUNTING", "MARKETING", "WHATSAPP"];
export const PROFILE_ROOT = "/var/lib/iabot/profiles";
export const PROFILE_PARALLEL_CAP = 3;

const KIND = new Set(AGENT_KINDS);
const ORG = /^[A-Za-z0-9_-]{1,80}$/;

function abortError() {
  return Object.assign(new Error("abort"), { name: "AbortError" });
}

function selection(input) {
  if (typeof input === "string") return { agentKind: input, organizationId: undefined };
  if (!input || typeof input !== "object") return { agentKind: "", organizationId: undefined };
  return {
    agentKind: typeof input.agentKind === "string" ? input.agentKind : "",
    organizationId: Object.prototype.hasOwnProperty.call(input, "organizationId") ? input.organizationId : undefined,
  };
}

export function profileDirFor(input, root = PROFILE_ROOT) {
  const { agentKind, organizationId } = selection(input);
  if (!KIND.has(agentKind)) throw new Error("agente");
  if (organizationId !== undefined && (typeof organizationId !== "string" || !ORG.test(organizationId))) {
    throw new Error("agente");
  }
  if (typeof root !== "string" || !root.trim()) throw new Error("agente");
  const base = path.resolve(root);
  const dir = path.resolve(base, agentKind);
  const relative = path.relative(base, dir);
  if (relative !== agentKind || relative.includes("..") || path.isAbsolute(relative)) throw new Error("agente");
  return dir;
}

export async function ensureProfileDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

export function createProfileGate({ cap = PROFILE_PARALLEL_CAP, root = PROFILE_ROOT } = {}) {
  if (!Number.isInteger(cap) || cap < 1 || cap > PROFILE_PARALLEL_CAP) throw new Error("cupo");
  const tails = new Map();
  let active = 0;
  const waiters = [];

  function acquireSlot() {
    if (active < cap) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  }

  function releaseSlot() {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  }

  return {
    root,
    cap,
    run(input, fn, signal) {
      const dir = profileDirFor(input, root);
      const previous = tails.get(dir) ?? Promise.resolve();
      const job = previous.then(async () => {
        if (signal?.aborted) throw abortError();
        await acquireSlot();
        try {
          if (signal?.aborted) throw abortError();
          return await fn(dir);
        } finally {
          releaseSlot();
        }
      });
      tails.set(
        dir,
        job.then(
          () => undefined,
          () => undefined,
        ),
      );
      return job;
    },
  };
}
