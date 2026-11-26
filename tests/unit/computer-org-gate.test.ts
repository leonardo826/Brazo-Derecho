import { afterEach, describe, expect, test, vi } from "vitest";
import { computerEnabledForOrg, computerEnabledOrgIds, computerOrgGateClosed } from "@/lib/computer/flag";
import { executeDesktopRequest, resetDesktopIntent } from "@/lib/chat/desktop-task";
import { idleCronResponse } from "@/lib/computer/idle-cron";
import { ensureComputerReady, memoryPowerStore, reapIdleComputers } from "@/lib/computer/power";
import { fakeProvider } from "@/lib/computer/provider";

vi.mock("@/lib/session", () => ({
  resolveSession: vi.fn(async () => ({
    userId: "user-a",
    email: "a@brazo.cl",
    name: "Ana",
    organizationId: "org-fuera",
    organizationName: "Fuera",
    role: "OWNER",
    authVersion: 0,
  })),
}));

vi.mock("@/lib/computer/lease", async () => {
  const actual = await vi.importActual<typeof import("@/lib/computer/lease")>("@/lib/computer/lease");
  return {
    ...actual,
    loadTenantLease: vi.fn(async () => {
      throw new Error("no debía leer el arriendo");
    }),
  };
});

import { POST as taskPost } from "@/app/api/computer/task/route";
import { POST as leasePost } from "@/app/api/computer/lease/route";
import { loadTenantLease } from "@/lib/computer/lease";
import { resolveSession } from "@/lib/session";

const on = { COMPUTER_FEATURE_ENABLED: "true", COMPUTER_ENABLED_ORGS: "org-a, org-b" };

describe("gating por organización", () => {
  afterEach(() => {
    delete process.env.COMPUTER_FEATURE_ENABLED;
    delete process.env.COMPUTER_ENABLED_ORGS;
    resetDesktopIntent();
    vi.mocked(resolveSession).mockClear();
    vi.mocked(loadTenantLease).mockClear();
  });

  test("lista vacía, org fuera, org dentro y flag apagado", () => {
    expect(computerEnabledOrgIds({})).toEqual(new Set());
    expect(computerEnabledOrgIds({ COMPUTER_ENABLED_ORGS: "  ,  " })).toEqual(new Set());
    expect(computerOrgGateClosed({ COMPUTER_FEATURE_ENABLED: "true" })).toBe(true);
    expect(computerEnabledForOrg("org-a", { COMPUTER_FEATURE_ENABLED: "true" })).toBe(false);
    expect(computerEnabledForOrg("org-a", { COMPUTER_FEATURE_ENABLED: "true", COMPUTER_ENABLED_ORGS: "" })).toBe(false);
    expect(computerEnabledForOrg("org-fuera", on)).toBe(false);
    expect(computerEnabledForOrg("org-a", on)).toBe(true);
    expect(computerEnabledForOrg("org-b", on)).toBe(true);
    expect(computerEnabledForOrg("org-a", { COMPUTER_FEATURE_ENABLED: "True", COMPUTER_ENABLED_ORGS: "org-a" })).toBe(false);
    expect(computerEnabledForOrg("org-a", { COMPUTER_ENABLED_ORGS: "org-a" })).toBe(false);
    expect(computerOrgGateClosed({ COMPUTER_FEATURE_ENABLED: "false", COMPUTER_ENABLED_ORGS: "org-a" })).toBe(true);
  });

  test("el chat no llama al computador si la org no está en la lista", async () => {
    process.env.COMPUTER_FEATURE_ENABLED = "true";
    process.env.COMPUTER_ENABLED_ORGS = "org-a";
    const loadLease = vi.fn(async () => ({ state: "ausente" as const }));
    const outside = await executeDesktopRequest({
      organizationId: "org-fuera",
      userId: "user-a",
      conversationId: "contador",
      agentKind: "ACCOUNTING",
      text: "usa el computador",
      loadLease,
    });
    expect(outside).toEqual({ kind: "chat" });
    expect(loadLease).not.toHaveBeenCalled();
    delete process.env.COMPUTER_ENABLED_ORGS;
    const empty = await executeDesktopRequest({
      organizationId: "org-a",
      userId: "user-a",
      conversationId: "contador",
      agentKind: "ACCOUNTING",
      text: "usa el computador",
      loadLease,
    });
    expect(empty).toEqual({ kind: "chat" });
    expect(loadLease).not.toHaveBeenCalled();
    process.env.COMPUTER_FEATURE_ENABLED = "false";
    process.env.COMPUTER_ENABLED_ORGS = "org-a";
    const off = await executeDesktopRequest({
      organizationId: "org-a",
      userId: "user-a",
      conversationId: "contador",
      agentKind: "ACCOUNTING",
      text: "usa el computador",
      loadLease,
    });
    expect(off).toEqual({ kind: "chat" });
    process.env.COMPUTER_FEATURE_ENABLED = "true";
    const inside = await executeDesktopRequest({
      organizationId: "org-a",
      userId: "user-a",
      conversationId: "contador",
      agentKind: "ACCOUNTING",
      text: "usa el computador",
      loadLease,
    });
    expect(inside.kind).toBe("reply");
    expect(loadLease).toHaveBeenCalledTimes(1);
  });

  test("las rutas niegan la lista vacía sin sesión y una org de afuera antes del arriendo", async () => {
    process.env.COMPUTER_FEATURE_ENABLED = "true";
    delete process.env.COMPUTER_ENABLED_ORGS;
    const empty = await taskPost(new Request("http://localhost/api/computer/task", { method: "POST", body: "{}" }));
    expect(empty.status).toBe(404);
    expect(resolveSession).not.toHaveBeenCalled();
    process.env.COMPUTER_ENABLED_ORGS = "org-a";
    const denied = await taskPost(new Request("http://localhost/api/computer/task", { method: "POST", body: "{}" }));
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe("");
    expect(loadTenantLease).not.toHaveBeenCalled();
    const lease = await leasePost(
      new Request("http://localhost/api/computer/lease", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "secreto-de-prueba-1234", endpoint: "https://10.0.0.1" }),
      }),
    );
    expect(lease.status).toBe(404);
    expect(loadTenantLease).not.toHaveBeenCalled();
  });

  test("el cron no apaga si el flag está off o la lista está vacía, y solo toca las orgs listadas", async () => {
    let ran = 0;
    const reap = async () => {
      ran += 1;
      return { stopped: ["org-a"], skippedBusy: [] };
    };
    const off = await idleCronResponse(
      new Request("https://app.local/api/cron/computer-idle", { headers: { authorization: "Bearer secreto-cron" } }),
      { env: { CRON_SECRET: "secreto-cron", COMPUTER_FEATURE_ENABLED: "false", COMPUTER_ENABLED_ORGS: "org-a" }, reap },
    );
    expect(await off.json()).toEqual({ ok: true, stopped: 0, busy: 0 });
    const empty = await idleCronResponse(
      new Request("https://app.local/api/cron/computer-idle", { headers: { authorization: "Bearer secreto-cron" } }),
      { env: { CRON_SECRET: "secreto-cron", COMPUTER_FEATURE_ENABLED: "true", COMPUTER_ENABLED_ORGS: "" }, reap },
    );
    expect(await empty.json()).toEqual({ ok: true, stopped: 0, busy: 0 });
    expect(ran).toBe(0);
    const listed = await idleCronResponse(
      new Request("https://app.local/api/cron/computer-idle", { headers: { authorization: "Bearer secreto-cron" } }),
      { env: { CRON_SECRET: "secreto-cron", COMPUTER_FEATURE_ENABLED: "true", COMPUTER_ENABLED_ORGS: "org-a" }, reap },
    );
    expect(await listed.json()).toEqual({ ok: true, stopped: 1, busy: 0 });
    expect(ran).toBe(1);

    const store = memoryPowerStore();
    const provider = fakeProvider();
    const meta = { provider: "fake", machineId: "maq-1", epoch: 1 };
    for (const id of ["org-a", "org-fuera"]) {
      expect((await store.claimStart(id, 0, 1_000, meta)).role).toBe("starter");
      expect(await store.markReady(id, 0, meta)).toBe(true);
    }
    const stopped = await reapIdleComputers({
      now: () => 20 * 60 * 1000,
      idleMs: 15 * 60 * 1000,
      store,
      provider,
      allowOrganizationIds: new Set(["org-a"]),
      closeBrowser: async () => "closed",
    });
    expect(stopped.stopped).toEqual(["org-a"]);
    expect((await store.read("org-fuera"))?.state).toBe("READY");
    expect(provider.calls.stop).toBe(1);
  });

  test("el encendido no arranca una org que no está en la lista", async () => {
    process.env.COMPUTER_FEATURE_ENABLED = "true";
    process.env.COMPUTER_ENABLED_ORGS = "org-a";
    const provider = fakeProvider();
    const result = await ensureComputerReady("org-fuera", {
      provider,
      store: memoryPowerStore(),
      loadLease: async () => ({
        state: "listo",
        lease: {
          organizationId: "org-fuera",
          machineId: "maq-1",
          baseUrl: "https://vm.ejemplo.cl",
          pin: "93.184.216.34",
          epoch: 1,
          token: "lease-token-de-prueba",
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("apagado");
    expect(provider.calls.start).toBe(0);
  });
});
