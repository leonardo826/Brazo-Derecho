import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SubscribeActions } from "@/components/trial-button";
import { moduleIsOpen } from "@/lib/agent-access";
import { AGENT_ORDER } from "@/lib/catalog";
import { recordsBillingUsage } from "@/lib/qa-account";
import { organizationSchema, registerSchema } from "@/lib/validation";

describe("módulos de la empresa de prueba", () => {
  test("QA abre los cuatro módulos sin suscripción y una empresa normal no", () => {
    expect(recordsBillingUsage(true)).toBe(false);
    expect(recordsBillingUsage(false)).toBe(true);
    for (const agent of AGENT_ORDER) {
      expect(agent).toBeTruthy();
      expect(moduleIsOpen({ suspended: false, qa: true, subscription: null })).toBe(true);
      expect(moduleIsOpen({ suspended: false, qa: false, subscription: null })).toBe(false);
    }
    expect(moduleIsOpen({ suspended: true, qa: true, subscription: null })).toBe(false);
    const future = new Date(Date.now() + 86_400_000);
    expect(
      moduleIsOpen({
        suspended: false,
        qa: false,
        subscription: { status: "TRIAL", periodEnd: future },
      }),
    ).toBe(true);
  });

  test("la pantalla de QA no dice que falta la suscripción ni ofrece un cobro", () => {
    const qa = renderToStaticMarkup(createElement(SubscribeActions, { agent: "MARKETING", back: "/panel/marketing", subscription: null, qa: true }));
    expect(qa).toContain("Revisión interna");
    expect(qa).not.toContain("Sin suscripción activa");
    expect(qa).not.toContain("Activar prueba");
    expect(qa).not.toContain("Mercado Pago");

    const normal = renderToStaticMarkup(createElement(SubscribeActions, { agent: "WHATSAPP", back: "/panel/whatsapp", subscription: null }));
    expect(normal).toContain("Sin suscripción activa");
    expect(normal).toContain("Activar prueba");
  });

  test("el usuario no puede marcar isQa desde un formulario", () => {
    const company = organizationSchema.safeParse({ organizationName: "Taller", rut: "", isQa: true });
    const account = registerSchema.safeParse({
      name: "Ana",
      email: "ana@taller.cl",
      password: "Clave-demo-2026",
      organizationName: "Taller",
      rut: "",
      isQa: true,
    });
    expect(company.success && "isQa" in company.data).toBe(false);
    expect(account.success && "isQa" in account.data).toBe(false);

    const actions = ["account.ts", "onboarding.ts", "auth.ts", "admin.ts", "subscriptions.ts"].map((name) =>
      readFileSync(path.join(process.cwd(), "src/app/actions", name), "utf8"),
    );
    for (const source of actions) expect(source).not.toMatch(/\bisQa\s*:/);
    expect(readFileSync(path.join(process.cwd(), "src/lib/qa-account.ts"), "utf8")).toMatch(/isQa:\s*true/);
  });
});
