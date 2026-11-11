import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  resolveSession: vi.fn(async () => ({
    userId: "user-a",
    email: "a@brazo.cl",
    name: "Ana",
    organizationId: "org-a",
    organizationName: "Org",
    role: "OWNER",
    authVersion: 0,
  })),
}));

vi.mock("@/lib/computer/lease", () => ({
  enrollComputerLease: vi.fn(async () => {
    throw new Error("no debía correr el alta");
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    computer: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    membership: { findUnique: vi.fn() },
  },
}));

import { POST as leasePost } from "@/app/api/computer/lease/route";
import { POST as enrollPost } from "@/app/api/computer/enroll/route";
import { GET as statusGet } from "@/app/api/computer/status/route";
import { POST as cancelPost } from "@/app/api/computer/cancel/route";
import { POST as taskPost } from "@/app/api/computer/task/route";
import { GET as novncGet } from "@/app/api/computer/novnc/route";
import { POST as novncTokenPost } from "@/app/api/computer/novnc-token/route";
import { enrollComputerLease } from "@/lib/computer/lease";
import { prisma } from "@/lib/prisma";
import { resolveSession } from "@/lib/session";
import { computerFeatureEnabled } from "@/lib/computer/flag";

const session = {
  userId: "user-a",
  email: "a@brazo.cl",
  name: "Ana",
  organizationId: "org-a",
  organizationName: "Org",
  role: "OWNER" as const,
  authVersion: 0,
};

describe("interruptor del computador", () => {
  beforeEach(() => {
    delete process.env.COMPUTER_FEATURE_ENABLED;
    vi.mocked(resolveSession).mockResolvedValue(session);
    vi.mocked(enrollComputerLease).mockClear();
    vi.mocked(prisma.computer.findUnique).mockClear();
    vi.mocked(prisma.computer.upsert).mockClear();
  });

  test("solo la cadena exacta true lo enciende", () => {
    expect(computerFeatureEnabled({})).toBe(false);
    expect(computerFeatureEnabled({ COMPUTER_FEATURE_ENABLED: "True" })).toBe(false);
    expect(computerFeatureEnabled({ COMPUTER_FEATURE_ENABLED: "1" })).toBe(false);
    expect(computerFeatureEnabled({ COMPUTER_FEATURE_ENABLED: " true" })).toBe(false);
    expect(computerFeatureEnabled({ COMPUTER_FEATURE_ENABLED: "true" })).toBe(true);
  });

  test("con el interruptor apagado el alta de una sesión válida no corre ni sale a la red", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("no debía haber red");
    });
    vi.stubGlobal("fetch", fetchImpl);
    const response = await leasePost(
      new Request("http://localhost/api/computer/lease", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "brazo_session=sesion-valida",
        },
        body: JSON.stringify({
          endpoint: "http://127.0.0.1:8787",
          machineId: "maquina-ajena",
          token: "secreto-de-prueba-1234",
        }),
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(enrollComputerLease).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.computer.findUnique).not.toHaveBeenCalled();
    expect(prisma.computer.upsert).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("las demás rutas del computador también se niegan antes de la base", async () => {
    const responses = await Promise.all([
      enrollPost(),
      statusGet(),
      cancelPost(),
      taskPost(new Request("http://localhost/api/computer/task", { method: "POST", body: "{}" })),
      novncGet(new Request("http://localhost/api/computer/novnc?token=abc")),
      novncTokenPost(),
    ]);
    for (const response of responses) expect(response.status).toBe(404);
    expect(prisma.computer.findUnique).not.toHaveBeenCalled();
    expect(prisma.computer.upsert).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });
});
