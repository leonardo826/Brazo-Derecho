import { describe, expect, test } from "vitest";
import { buildComputerRequest } from "../../agent-runtime/src/xai";
import { isDeclarationGoal, isHighRiskGoal } from "../../agent-runtime/src/sensitive";
import {
  accountantChatInstructions,
  APPROVED_PORTAL_NOTE,
  planPortalAccess,
  promptBlocksVaultLogin,
  vaultContext,
} from "@/lib/chat/accountant";
import { ACCOUNTING_PUBLIC_NOTE, AGENT_CATALOG, instructionsFor } from "@/lib/catalog";
import { ACTION_HELP } from "@/lib/chat/public";

const SECRET = "ZzClaveSuperSecreta";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function accountingPrompt() {
  return [
    instructionsFor("ACCOUNTING", "Los Aromos"),
    accountantChatInstructions("Los Aromos"),
    APPROVED_PORTAL_NOTE,
    AGENT_CATALOG.ACCOUNTING.does.join("\n"),
    AGENT_CATALOG.ACCOUNTING.doesNot.join("\n"),
    ACCOUNTING_PUBLIC_NOTE,
    ACTION_HELP,
    vaultContext([{ id: "cred12345678", label: "Clave SII", portal: "SII", usernameHint: "9988" }]),
  ].join("\n");
}

describe("contador y bóveda", () => {
  test("el prompt ya no prohíbe entrar con la bóveda y pide respuestas breves", () => {
    const prompt = accountingPrompt();
    expect(promptBlocksVaultLogin(prompt)).toBe(false);
    expect(prompt).toContain("fill");
    expect(prompt).toContain("credentialId");
    expect(prompt).toContain("/panel/boveda");
    expect(prompt).toMatch(/una o dos frases/);
    expect(prompt).not.toContain(SECRET);
    expect(AGENT_CATALOG.ACCOUNTING.does.join(" ")).toMatch(/Bóveda/);
    expect(AGENT_CATALOG.ACCOUNTING.doesNot.join(" ")).toMatch(/confirmación/);
    expect(ACCOUNTING_PUBLIC_NOTE).toMatch(/Bóveda/);
    expect(ACCOUNTING_PUBLIC_NOTE.toLowerCase()).not.toContain("no uso claves");
  });

  test("con credencial el plan es fill y no menciona la clave", () => {
    const plan = planPortalAccess("entra al SII con mi clave de la bóveda", [
      { id: "cred12345678", label: "Clave SII", portal: "SII", usernameHint: "9988" },
    ]);
    expect(plan.kind).toBe("fill");
    if (plan.kind !== "fill") return;
    expect(plan.credential.id).toBe("cred12345678");
    expect(plan.message).toContain("Clave SII");
    expect(plan.message).toContain("9988");
    expect(plan.message).toMatch(/Bóveda/);
    expect(plan.message.toLowerCase()).not.toContain("no uso claves");
    expect(plan.message.toLowerCase()).not.toContain("no puedo ingresar");
    expect(JSON.stringify(plan)).not.toContain(SECRET);
    expect("secret" in plan.credential).toBe(false);
  });

  test("sin credencial ofrece la bóveda", () => {
    const plan = planPortalAccess("entra al SII a revisar ventas", []);
    expect(plan.kind).toBe("vault");
    expect(plan.message).toContain("/panel/boveda");
    expect(plan.message).toMatch(/guarda la clave/i);
    expect(plan.message.toLowerCase()).not.toContain("no uso claves");
    expect(plan.message.toLowerCase()).not.toContain("no puedo ingresar");
    expect(promptBlocksVaultLogin(plan.message)).toBe(false);
  });

  test("revisar el F29 no es declarar; presentarlo sí", () => {
    expect(isHighRiskGoal("Entra al SII a revisar ventas")).toBe(false);
    expect(isHighRiskGoal("Revisa el F29 en el SII")).toBe(false);
    expect(isDeclarationGoal("Presenta el F29 de octubre")).toBe(true);
    expect(isHighRiskGoal("Presenta la declaración de IVA")).toBe(true);
    expect(isHighRiskGoal("Paga el IVA en el SII")).toBe(true);
  });

  test("la herramienta del computador pide fill y la bóveda, en breve", () => {
    const request = buildComputerRequest({
      model: "grok-4.3",
      goal: "Entra al SII a revisar ventas",
      screenshot: PNG,
      history: [],
      credentials: [{ id: "cred12345678", label: "Clave SII", portal: "SII", usernameHint: "9988" }],
    });
    const packed = JSON.stringify(request);
    expect(promptBlocksVaultLogin(packed)).toBe(false);
    expect(packed).toContain("credentialId");
    expect(packed).toContain("fill");
    expect(packed).toContain("/panel/boveda");
    expect(packed).toMatch(/una o dos frases/);
    expect(packed).toContain("cred12345678");
    expect(packed).not.toContain(SECRET);
    expect(packed).not.toContain("fillGrant");
  });
});
