import { createHmac, timingSafeEqual } from "node:crypto";

function bare(address) {
  return address.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function v4Private(parts) {
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function parseV4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const raw = match.slice(1);
  if (raw.some((part) => part.length > 1 && part.startsWith("0"))) return "ambiguous";
  const parts = raw.map(Number);
  if (parts.some((part) => part > 255)) return "ambiguous";
  return parts;
}

function parseSide(side) {
  if (!side) return [];
  const groups = side.split(":");
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

export function expandIpv6(input) {
  let host = bare(input);
  if (!host || host.includes("%")) return null;
  const tail = host.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const parts = parseV4(tail[2] ?? "");
    if (!parts || parts === "ambiguous") return null;
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    host = `${tail[1]}${hi}:${lo}`;
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const groups = parseSide(halves[0] ?? "");
    if (!groups || groups.length !== 8) return null;
    return groups;
  }
  const left = parseSide(halves[0] ?? "");
  const right = parseSide(halves[1] ?? "");
  if (!left || !right || left.length + right.length > 7) return null;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

function embeddedV4(hi, lo) {
  return v4Private([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
}

function v6Private(groups) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (groups.every((group) => group === 0)) return true;
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) return embeddedV4(g6, g7);
  if (g0 === 0x2002) return embeddedV4(g1, g2);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embeddedV4(g6, g7);
  return false;
}

export function isIpAddress(address) {
  const host = bare(address);
  if (host.includes("%")) return false;
  const v4 = parseV4(host);
  if (v4 === "ambiguous") return true;
  if (v4) return true;
  return expandIpv6(host) !== null;
}

export function isPrivateAddress(address) {
  const host = bare(address);
  if (!host || host.includes("%")) return true;
  const v4 = parseV4(host);
  if (v4 === "ambiguous") return true;
  if (v4) return v4Private(v4);
  const v6 = expandIpv6(host);
  if (v6) return v6Private(v6);
  return false;
}

export function handshakeProof(token, nonce, machineId) {
  return createHmac("sha256", token).update(`${nonce}\n${machineId}`).digest("base64url");
}

export function proofsMatch(expected, proof) {
  if (typeof proof !== "string" || !proof) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(proof);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function blockedHost(host) {
  return (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  );
}

export function publicUrl(raw) {
  const match = String(raw).match(/https:\/\/[^\s<>"']+/i);
  if (!match) return null;
  let url;
  try {
    url = new URL(match[0]);
  } catch {
    return null;
  }
  if (url.username || url.password || url.protocol !== "https:") return null;
  const host = bare(url.hostname);
  if (blockedHost(host)) return null;
  if (isIpAddress(host) && isPrivateAddress(host)) return null;
  return url.toString();
}
