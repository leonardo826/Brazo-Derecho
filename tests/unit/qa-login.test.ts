import { afterEach, describe, expect, test, vi } from "vitest";
import { isQaLogin, passwordsMatch, recordsBillingUsage } from "@/lib/qa-account";

const EMAIL = "qa.interno@test.local";
const PASSWORD = "Clave-qa-prueba-2026";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("login QA", () => {
  test("sin secretos de prueba no reconoce el ingreso", () => {
    vi.stubEnv("QA_LOGIN_EMAIL", "");
    vi.stubEnv("QA_LOGIN_PASSWORD", "");
    expect(isQaLogin(EMAIL, PASSWORD)).toBe(false);
  });

  test("solo el correo y la clave de prueba coinciden, y la clave se compara entera", () => {
    vi.stubEnv("QA_LOGIN_EMAIL", " QA.Interno@Test.Local ");
    vi.stubEnv("QA_LOGIN_PASSWORD", PASSWORD);
    expect(isQaLogin(EMAIL, PASSWORD)).toBe(true);
    expect(isQaLogin("otro@test.local", PASSWORD)).toBe(false);
    expect(isQaLogin(EMAIL, "Clave-qa-prueba-2027")).toBe(false);
    expect(isQaLogin(EMAIL, PASSWORD.slice(0, -1))).toBe(false);
    expect(isQaLogin(EMAIL, `${PASSWORD} `)).toBe(false);
    expect(passwordsMatch(PASSWORD, PASSWORD)).toBe(true);
    expect(passwordsMatch("", PASSWORD)).toBe(false);
    expect(recordsBillingUsage(false)).toBe(true);
    expect(recordsBillingUsage(true)).toBe(false);
  });
});
