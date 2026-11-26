const V4_NETS = ["169.254.0.0/16", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "192.88.99.0/24", "0.0.0.0/8"];
const V6_NETS = ["fe80::/10", "fc00::/7", "2001:db8::/32", "2001::/32", "64:ff9b:1::/48"];

export function egressSpec(family) {
  if (family === "v6") {
    return { chain: "IABOT-EGRESS6", jumpChain: "ufw6-before-output", loop: "::1", nets: V6_NETS };
  }
  return { chain: "IABOT-EGRESS", jumpChain: "ufw-before-output", loop: "127.0.0.0/8", nets: V4_NETS };
}

export function egressRules({ family, resolver }) {
  const { chain, loop, nets } = egressSpec(family);
  const lines = [];
  if (resolver) lines.push(`-A ${chain} -p udp -d ${resolver} --dport 53 -j RETURN`);
  lines.push(`-A ${chain} -p udp -j REJECT`);
  for (const spec of nets) lines.push(`-A ${chain} -d ${spec} -j REJECT`);
  lines.push(`-A ${chain} -d ${loop} -p tcp --dport 8787 -j REJECT`);
  lines.push(`-A ${chain} -j RETURN`);
  return lines;
}

function strip(text, chain) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === `:${chain} - [0:0]`) return false;
      if (trimmed.startsWith(`-A ${chain} `)) return false;
      if (trimmed.includes(` -j ${chain}`)) return false;
      return true;
    })
    .join("\n");
}

export function renderUfwFile(source, { family, uid, resolver = "" }) {
  const { chain, jumpChain } = egressSpec(family);
  const rules = egressRules({ family, resolver });
  const lines = strip(source, chain).split("\n");
  const filter = lines.findIndex((line) => line.trim() === "*filter");
  if (filter < 0) throw new Error("sin tabla filter");
  lines.splice(filter + 1, 0, `:${chain} - [0:0]`);
  const firstAppend = lines.findIndex((line, index) => index > filter && line.trim().startsWith("-A "));
  if (firstAppend < 0) throw new Error("sin reglas en filter");
  lines.splice(firstAppend, 0, ...rules);
  const lo = `-A ${jumpChain} -o lo -j ACCEPT`;
  const jump = `-A ${jumpChain} -m owner --uid-owner ${uid} -j ${chain}`;
  const loIndex = lines.findIndex((line) => line.trim() === lo);
  if (loIndex < 0) throw new Error(`falta ${lo}`);
  lines.splice(loIndex, 0, jump);
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? "") : "";
}

if (process.argv[1] && process.argv[1].endsWith("render-ufw.mjs")) {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(flag("--input"), "utf8");
  process.stdout.write(renderUfwFile(source, { family: flag("--family"), uid: flag("--uid"), resolver: flag("--resolver") }));
}
