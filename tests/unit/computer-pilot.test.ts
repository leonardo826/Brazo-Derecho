import { describe, expect, test, vi } from "vitest";
import { computerPanelEnabled } from "@/lib/computer/flag";
import { panelComputerHref } from "@/components/panel-nav";
import { issueNovncToken, novncStillValid, tokenMatches } from "@/lib/computer/novnc";
import { decideSensitiveTask, enqueueComputerTask, type ComputerStore, type ComputerTaskRecord } from "@/lib/computer/orchestrator";
import { cliWillCallFly, flyCallsAllowed, flyRequests, planProvision, provisionClient } from "@/lib/computer/provision";

function memoryStore() {
  const tasks: ComputerTaskRecord[] = [];
  const store: ComputerStore = {
    async ensure() {
      return { id: "comp_1" };
    },
    async insert(task) {
      const row = { ...task, id: `task_${tasks.length + 1}` };
      tasks.push(row);
      return row;
    },
    async finish(id, status, result) {
      const row = tasks.find((item) => item.id === id);
      if (!row) throw new Error("falta");
      row.status = status;
      row.result = result;
      return row;
    },
    async get(id) {
      return tasks.find((item) => item.id === id) ?? null;
    },
  };
  return store;
}

describe("piloto del computador", () => {
  test("sin URL no llama al agente y una acción sensible no sale", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("no debía haber red");
    });
    const store = memoryStore();
    const queued = await enqueueComputerTask(
      { clientId: "cliente1", goal: "Abre https://example.com", fetchImpl: fetchMock as typeof fetch },
      { store },
    );
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.calledAgent).toBe(false);
    expect(queued.task.status).toBe("QUEUED");

    const pending = await enqueueComputerTask(
      { clientId: "cliente1", goal: "Paga la cuenta del proveedor", agentUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock as typeof fetch },
      { store },
    );
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.task.status).toBe("PENDING_APPROVAL");
    expect(fetchMock).not.toHaveBeenCalled();

    const approved = await decideSensitiveTask(store, { clientId: "cliente1", taskId: pending.task.id, decision: "APPROVED" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.task.status).toBe("APPROVED");
    expect(approved.task.result).toMatch(/apagados/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("revisar ventas o el F29 llama al agente y presentar queda pendiente", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "DONE", result: "Ventas revisadas." }), { status: 200 }));
    const review = await enqueueComputerTask(
      {
        clientId: "cliente1",
        goal: "Revisa el F29 en el SII",
        agentUrl: "http://agente.internal:8787/",
        fetchImpl: fetchMock as typeof fetch,
        agentPayload: {
          credentials: [{ id: "cred12345678", label: "Clave SII", portal: "SII", usernameHint: "9988" }],
          fillGrant: "grant-de-prueba-que-no-es-la-clave",
        },
      },
      { store: memoryStore() },
    );
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.calledAgent).toBe(true);
    expect(review.task.status).toBe("DONE");
    expect(JSON.stringify(review)).not.toContain("grant-de-prueba-que-no-es-la-clave");

    const filing = await enqueueComputerTask(
      {
        clientId: "cliente1",
        goal: "Presenta el F29 de octubre",
        agentUrl: "http://agente.internal:8787/",
        fetchImpl: fetchMock as typeof fetch,
      },
      { store: memoryStore() },
    );
    expect(filing.ok).toBe(true);
    if (!filing.ok) return;
    expect(filing.task.status).toBe("PENDING_APPROVAL");
    expect(filing.calledAgent).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("presentar una declaración queda pendiente y no llama al agente", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("no debía haber red");
    });
    const result = await enqueueComputerTask(
      {
        clientId: "cliente1",
        goal: "Presenta la declaración de renta en el SII",
        agentUrl: "http://agente.internal:8787/",
        fetchImpl: fetchMock as typeof fetch,
      },
      { store: memoryStore() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.status).toBe("PENDING_APPROVAL");
    expect(result.calledAgent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("el relleno va en el cuerpo al agente y no queda en la tarea", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "DONE", result: "Ingreso listo. grant-de-prueba-que-no-es-la-clave" }), { status: 200 }));
    const secret = "ZzVaultSecret99";
    const result = await enqueueComputerTask(
      {
        clientId: "cliente1",
        goal: "Entra al SII con mi clave",
        agentUrl: "http://agente.internal:8787/",
        fetchImpl: fetchMock as typeof fetch,
        agentPayload: {
          credentials: [{ id: "cred12345678", label: "SII", portal: "SII", usernameHint: "9988" }],
          fillGrant: "grant-de-prueba-que-no-es-la-clave",
        },
      },
      { store: memoryStore() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.task)).not.toContain(secret);
    expect(JSON.stringify(result.task)).not.toContain("grant-de-prueba");
    expect(result.task.result).toContain("[redactado]");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { credentials: { usernameHint: string }[]; fillGrant: string };
    expect(body.credentials[0]?.usernameHint).toBe("9988");
    expect(body.fillGrant).toBe("grant-de-prueba-que-no-es-la-clave");
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("grant-de-prueba-que-no-es-la-clave");
  });

  test("con URL encola y llama a /task", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "DONE", result: "Example cargó." }), { status: 200 }));
    const result = await enqueueComputerTask(
      { clientId: "cliente1", goal: "Abre https://example.com", agentUrl: "http://agente.internal:8787/", fetchImpl: fetchMock as typeof fetch },
      { store: memoryStore() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calledAgent).toBe(true);
    expect(result.task.status).toBe("DONE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://agente.internal:8787/task");
    expect(JSON.parse(String(init.body))).toEqual({ goal: "Abre https://example.com" });
  });

  test("el token de noVNC dura 10 minutos y no se guarda en claro", () => {
    const now = new Date("2026-11-05T12:00:00.000Z");
    const issued = issueNovncToken(now);
    expect(issued.expiresAt.toISOString()).toBe("2026-11-05T12:10:00.000Z");
    expect(issued.token).not.toBe(issued.hash);
    expect(tokenMatches(issued.token, issued.hash)).toBe(true);
    expect(tokenMatches("otro", issued.hash)).toBe(false);
    expect(novncStillValid(issued.expiresAt, new Date("2026-11-05T12:09:59.000Z"))).toBe(true);
    expect(novncStillValid(issued.expiresAt, new Date("2026-11-05T12:10:00.000Z"))).toBe(false);
  });

  test("el panel del computador no aparece en producción si el flag está apagado", () => {
    expect(computerPanelEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(computerPanelEnabled({ NODE_ENV: "production", COMPUTER_PANEL: "true" })).toBe(false);
    expect(computerPanelEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(computerPanelEnabled({ NODE_ENV: "production", COMPUTER_PANEL: "true", COMPUTER_FEATURE_ENABLED: "true" })).toBe(true);
    expect(computerPanelEnabled({ NODE_ENV: "development", COMPUTER_FEATURE_ENABLED: "true" })).toBe(true);
    expect(computerPanelEnabled({ NODE_ENV: "production", COMPUTER_FEATURE_ENABLED: "True" })).toBe(false);
    expect(panelComputerHref(false)).toBeNull();
    expect(panelComputerHref(computerPanelEnabled({ NODE_ENV: "production" }))).toBeNull();
    expect(panelComputerHref(true)).toBe("/panel/computador");
  });

  test("Fly queda en dry-run salvo confirmación explícita y el plan no lleva secretos", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("no debía llamar a Fly");
    });
    expect(flyCallsAllowed({})).toBe(false);
    expect(flyCallsAllowed({ FLY_API_TOKEN: "fly-test", FLY_DRY_RUN: "true" })).toBe(false);
    expect(flyCallsAllowed({ FLY_API_TOKEN: "fly-test" })).toBe(false);
    expect(flyCallsAllowed({ FLY_DRY_RUN: "false" })).toBe(false);
    expect(cliWillCallFly({ FLY_DRY_RUN: "false", FLY_API_TOKEN: "fly-test" }, [])).toBe(false);
    expect(cliWillCallFly({ FLY_DRY_RUN: "False", FLY_API_TOKEN: "fly-test" }, ["--confirmo-gasto"])).toBe(false);

    const dry = await provisionClient({
      clientId: "orgdemo01",
      env: { FLY_API_TOKEN: "fly-test", FLY_DRY_RUN: "true" },
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.called).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const plan = planProvision({ clientId: "orgdemo01", env: { FLY_REGION: "gru" } });
    const requests = flyRequests(plan, "vol_prueba");
    const machine = requests[2].body as { config: { env: Record<string, string>; mounts: { path: string }[]; services?: unknown } };
    expect(requests.map((item) => item.url)).toEqual([
      "https://api.machines.dev/v1/apps",
      "https://api.machines.dev/v1/apps/iabot-desk-orgdemo01/volumes",
      "https://api.machines.dev/v1/apps/iabot-desk-orgdemo01/machines",
    ]);
    expect(machine.config.mounts[0].path).toBe("/data");
    expect(machine.config.services).toBeUndefined();
    expect(machine.config.env.XAI_API_KEY).toBeUndefined();
    expect(JSON.stringify(machine)).not.toMatch(/FLY_API_TOKEN/);
    expect(plan.autostop).toBe(false);
  });

  test("la ruta viva solo existe detrás del flag y usa fetch inyectado", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/volumes")) return new Response(JSON.stringify({ id: "vol_1" }), { status: 200 });
      if (String(url).endsWith("/machines")) return new Response(JSON.stringify({ id: "mach_1" }), { status: 200 });
      return new Response(JSON.stringify({ id: "app_1" }), { status: 200 });
    });
    const result = await provisionClient({
      clientId: "orgdemo01",
      env: { FLY_DRY_RUN: "false", FLY_API_TOKEN: "fly-test", FLY_REGION: "gru" },
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(result.called).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const first = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(first[0]).toBe("https://api.machines.dev/v1/apps");
    expect((first[1].headers as Record<string, string>).Authorization).toBe("Bearer fly-test");
    if (!result.dryRun) {
      expect(result.volumeId).toBe("vol_1");
      expect(result.machineId).toBe("mach_1");
    }
  });
});
