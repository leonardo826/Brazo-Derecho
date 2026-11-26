import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export const AGENT_KINDS = ["ACCOUNTING", "MARKETING", "WHATSAPP"];
export const PROFILE_ROOT = "/var/lib/iabot/profiles";
export const PROFILE_PARALLEL_CAP = 3;
export const PROFILE_QUEUE_CAP = 5;
export const PROFILE_WAIT_MS = 60_000;

const KIND = new Set(AGENT_KINDS);
const ORG = /^[A-Za-z0-9_-]{1,80}$/;

export function profileBusy(status) {
  return Object.assign(new Error("ocupado"), { status, name: "ProfileBusy" });
}

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

async function walkReal(absolute) {
  const parts = absolute.split(path.sep).filter(Boolean);
  let cursor = path.parse(absolute).root;
  const rootStat = await lstat(cursor);
  if (rootStat.isSymbolicLink()) throw new Error("agente");
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if (error && error.code === "ENOENT") return { cursor, missing: true };
      throw new Error("agente");
    }
    if (info.isSymbolicLink()) throw new Error("agente");
  }
  return { cursor, missing: false };
}

export async function ensureProfileDir(dir, root = PROFILE_ROOT) {
  const base = path.resolve(root);
  const target = path.resolve(dir);
  const relative = path.relative(base, target);
  if (!KIND.has(relative) || relative.includes("..") || path.isAbsolute(relative)) throw new Error("agente");
  const walkedBase = await walkReal(base);
  if (walkedBase.missing) throw new Error("agente");
  const realBase = await realpath(base);
  if (realBase !== base) throw new Error("agente");
  const walked = await walkReal(target);
  if (walked.missing) {
    if (walked.cursor !== target) throw new Error("agente");
    const parent = path.dirname(target);
    const realParent = await realpath(parent);
    if (realParent !== realBase) throw new Error("agente");
    try {
      await mkdir(target, { mode: 0o700 });
    } catch {
      throw new Error("agente");
    }
  }
  const created = await lstat(target);
  if (created.isSymbolicLink() || !created.isDirectory()) throw new Error("agente");
  const realTarget = await realpath(target);
  if (realTarget !== path.join(realBase, relative)) throw new Error("agente");
  await chmod(target, 0o700);
  return target;
}

export function createProfileGate({
  cap = PROFILE_PARALLEL_CAP,
  root = PROFILE_ROOT,
  queueCap = PROFILE_QUEUE_CAP,
  waitMs = PROFILE_WAIT_MS,
} = {}) {
  if (!Number.isInteger(cap) || cap < 1 || cap > PROFILE_PARALLEL_CAP) throw new Error("cupo");
  if (!Number.isInteger(queueCap) || queueCap < 1) throw new Error("cupo");
  if (!Number.isInteger(waitMs) || waitMs < 1) throw new Error("cupo");
  const slots = new Map();
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

  function slotFor(dir) {
    let slot = slots.get(dir);
    if (!slot) {
      slot = { tail: Promise.resolve(), waiting: 0 };
      slots.set(dir, slot);
    }
    return slot;
  }

  return {
    root,
    cap,
    queueCap,
    waitMs,
    run(input, fn, signal) {
      if (signal?.aborted) throw abortError();
      const dir = profileDirFor(input, root);
      const slot = slotFor(dir);
      if (slot.waiting >= queueCap) throw profileBusy(429);
      slot.waiting += 1;
      let gaveUp = false;
      let left = false;
      let settled = false;
      const leave = () => {
        if (left) return;
        left = true;
        slot.waiting -= 1;
      };
      let settle;
      const caller = new Promise((resolve, reject) => {
        settle = {
          resolve: (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          },
          reject: (error) => {
            if (settled) return;
            settled = true;
            reject(error);
          },
        };
      });
      const timer = setTimeout(() => {
        if (gaveUp) return;
        gaveUp = true;
        leave();
        settle.reject(profileBusy(503));
      }, waitMs);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            if (gaveUp) return;
            gaveUp = true;
            clearTimeout(timer);
            leave();
            settle.reject(abortError());
          },
          { once: true },
        );
      }
      const turn = slot.tail.then(async () => {
        if (gaveUp) return;
        await acquireSlot();
        if (gaveUp) {
          releaseSlot();
          return;
        }
        clearTimeout(timer);
        leave();
        try {
          if (signal?.aborted) throw abortError();
          settle.resolve(await fn(dir));
        } catch (error) {
          settle.reject(error);
        } finally {
          releaseSlot();
        }
      });
      slot.tail = turn.then(
        () => undefined,
        () => undefined,
      );
      turn.catch((error) => settle.reject(error));
      return caller;
    },
  };
}
