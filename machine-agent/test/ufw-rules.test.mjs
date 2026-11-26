import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { renderUfwFile, undeclaredJumps } from "../firewall/render-ufw.mjs";

const before4 = `# sample
*filter
:ufw-before-input - [0:0]
:ufw-before-output - [0:0]
:ufw-before-forward - [0:0]
-A ufw-before-input -i lo -j ACCEPT
-A ufw-before-output -o lo -j ACCEPT
-A ufw-before-input -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
-A ufw-before-output -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
COMMIT
`;

const before6 = `# sample6
*filter
:ufw6-before-input - [0:0]
:ufw6-before-output - [0:0]
:ufw6-before-forward - [0:0]
-A ufw6-before-input -i lo -j ACCEPT
-A ufw6-before-output -o lo -j ACCEPT
-A ufw6-before-input -p icmpv6 --icmpv6-type destination-unreachable -j ACCEPT
COMMIT
`;

function commandPath(name) {
  const found = spawnSync("bash", ["-lc", `command -v ${name}`], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : "";
}

function legacyRestore(family) {
  return commandPath(family === "v6" ? "ip6tables-legacy-restore" : "iptables-legacy-restore");
}

function restoreTest(command, input) {
  const direct = spawnSync(command, ["--test"], { input, encoding: "utf8" });
  const denied = direct.error != null || /Permission denied|xtables.lock/.test(`${direct.stderr || ""}`);
  if (direct.status === 0 || !denied) return direct;
  return spawnSync("sudo", ["-n", command, "--test"], { input, encoding: "utf8" });
}

test("cada familia declara su cadena y el salto va antes del loopback", () => {
  const v4 = renderUfwFile(before4, { family: "v4", uid: "123", resolver: "127.0.0.53" });
  const v6 = renderUfwFile(before6, { family: "v6", uid: "123", resolver: "" });
  assert.ok(v4.indexOf(":IABOT-EGRESS - [0:0]") < v4.indexOf("-A "));
  assert.ok(v6.indexOf(":IABOT-EGRESS6 - [0:0]") < v6.indexOf("-A "));
  assert.match(v4, /-A ufw-before-output -m owner --uid-owner 123 -j IABOT-EGRESS\n-A ufw-before-output -o lo -j ACCEPT/);
  assert.match(v6, /-A ufw6-before-output -m owner --uid-owner 123 -j IABOT-EGRESS6\n-A ufw6-before-output -o lo -j ACCEPT/);
  assert.equal(v6.includes("-A ufw-before-output "), false);
  assert.equal(renderUfwFile(v4, { family: "v4", uid: "123", resolver: "127.0.0.53" }), v4);
  assert.equal(renderUfwFile(v6, { family: "v6", uid: "123", resolver: "" }), v6);
  assert.deepEqual(undeclaredJumps(v4), []);
  assert.deepEqual(undeclaredJumps(v6), []);
  const broken = v6.replace(":IABOT-EGRESS6 - [0:0]\n", "");
  assert.deepEqual(undeclaredJumps(broken), ["IABOT-EGRESS6"]);

  const v4bin = legacyRestore("v4");
  const v6bin = legacyRestore("v6");
  if (!v4bin || !v6bin) return;
  const v4check = restoreTest(v4bin, v4);
  const v6check = restoreTest(v6bin, v6);
  const brokenCheck = restoreTest(v6bin, broken);
  assert.equal(v4check.status, 0, v4check.stderr);
  assert.equal(v6check.status, 0, v6check.stderr);
  assert.notEqual(brokenCheck.status, 0, brokenCheck.stderr);
});
