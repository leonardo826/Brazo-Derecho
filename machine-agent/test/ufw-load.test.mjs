import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const loadScript = fileURLToPath(new URL("../firewall/load-ufw.sh", import.meta.url));

function harness({ status, v4jump, v6jump }) {
  const dir = mkdtempSync(join(tmpdir(), "ufw-load-"));
  const bin = join(dir, "bin");
  const rules = join(dir, "rules");
  const bak = join(dir, "bak");
  const log = join(dir, "log");
  mkdirSync(bin);
  mkdirSync(rules);
  mkdirSync(bak);
  writeFileSync(join(rules, "before.rules"), "live\n");
  writeFileSync(join(rules, "before6.rules"), "live6\n");
  writeFileSync(join(bak, "before.rules"), "backup\n");
  writeFileSync(join(bak, "before6.rules"), "backup6\n");
  writeFileSync(log, "");
  writeFileSync(
    join(bin, "ufw"),
    `#!/bin/bash
printf 'ufw %s\\n' "$*" >> ${JSON.stringify(log)}
if [[ "$1" == "status" ]]; then printf 'Status: ${status}\\n'; fi
exit 0
`,
  );
  writeFileSync(
    join(bin, "iptables"),
    `#!/bin/bash
printf 'iptables %s\\n' "$*" >> ${JSON.stringify(log)}
${v4jump ? "printf '%s\\n' '-A ufw-before-output -j IABOT-EGRESS'" : "printf '%s\\n' '-A ufw-before-output -j ACCEPT'"}
exit 0
`,
  );
  writeFileSync(
    join(bin, "ip6tables"),
    `#!/bin/bash
printf 'ip6tables %s\\n' "$*" >> ${JSON.stringify(log)}
${v6jump ? "printf '%s\\n' '-A ufw6-before-output -j IABOT-EGRESS6'" : "printf '%s\\n' '-A ufw6-before-output -j ACCEPT'"}
exit 0
`,
  );
  for (const name of ["ufw", "iptables", "ip6tables"]) chmodSync(join(bin, name), 0o755);
  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
source ${JSON.stringify(loadScript)}
if run_ufw_load; then
  echo LOAD_OK
else
  rollback_ufw_files ${JSON.stringify(bak)}
  echo LOAD_FAIL
  exit 1
fi`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        UFW_BIN: join(bin, "ufw"),
        IPTABLES_BIN: join(bin, "iptables"),
        IP6TABLES_BIN: join(bin, "ip6tables"),
        UFW_RULES_DIR: rules,
      },
    },
  );
  return {
    result,
    log: readFileSync(log, "utf8"),
    rules: readFileSync(join(rules, "before.rules"), "utf8"),
    rules6: readFileSync(join(rules, "before6.rules"), "utf8"),
  };
}

test("ufw ya activo se recarga y no se vuelve a encender", () => {
  const { result, log, rules } = harness({ status: "active", v4jump: true, v6jump: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LOAD_OK/);
  assert.match(log, /^ufw reload$/m);
  assert.equal(log.includes("--force"), false);
  assert.equal(rules, "live\n");
});

test("ufw inactivo se enciende con --force enable", () => {
  const { result, log } = harness({ status: "inactive", v4jump: true, v6jump: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /^ufw --force enable$/m);
  assert.equal(/^ufw reload$/m.test(log), false);
});

test("un salto ausente con ufw activo restaura el respaldo y recarga", () => {
  const { result, log, rules, rules6 } = harness({ status: "active", v4jump: false, v6jump: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /LOAD_FAIL/);
  assert.match(log, /^ufw reload$/m);
  assert.equal(log.includes("--force"), false);
  assert.equal(rules, "backup\n");
  assert.equal(rules6, "backup6\n");
});
