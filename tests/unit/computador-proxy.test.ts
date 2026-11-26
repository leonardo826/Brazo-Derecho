import { NextRequest } from "next/server";
import { afterEach, describe, expect, test } from "vitest";
import { SESSION_COOKIE } from "@/lib/cookie";
import { proxy } from "@/proxy";
import { createSessionToken } from "@/lib/session-token";

async function sessionCookie(organizationId: string) {
  const token = await createSessionToken({
    userId: "user-a",
    email: "a@brazo.cl",
    name: "Ana",
    organizationId,
    organizationName: "Org",
    role: "OWNER",
    authVersion: 0,
  });
  return `${SESSION_COOKIE}=${token}`;
}

function page(cookie = "") {
  return proxy(
    new NextRequest("http://localhost/panel/computador", {
      headers: cookie ? { cookie } : {},
    }),
  );
}

describe("el computador apagado", () => {
  afterEach(() => {
    delete process.env.COMPUTER_FEATURE_ENABLED;
    delete process.env.COMPUTER_ENABLED_ORGS;
  });

  test("responde 404 antes de la página aunque la petición traiga sesión", async () => {
    delete process.env.COMPUTER_FEATURE_ENABLED;
    const response = await page("bd_session=sesion-valida");
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("Esta página no existe.");
    expect(html).toContain('href="/panel"');
    expect(html).not.toContain("cotización");
  });

  test("con el flag encendido y la lista vacía tampoco abre la página", async () => {
    process.env.COMPUTER_FEATURE_ENABLED = "true";
    delete process.env.COMPUTER_ENABLED_ORGS;
    const response = await page(await sessionCookie("org-a"));
    expect(response.status).toBe(404);
  });

  test("con la función encendida deja pasar solo a una org de la lista", async () => {
    process.env.COMPUTER_FEATURE_ENABLED = "true";
    process.env.COMPUTER_ENABLED_ORGS = "org-a";
    const allowed = await page(await sessionCookie("org-a"));
    expect(allowed.status).toBe(200);
    const denied = await page(await sessionCookie("org-b"));
    expect(denied.status).toBe(404);
  });
});
