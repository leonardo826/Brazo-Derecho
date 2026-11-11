import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { publicCommit } from "@/lib/build-commit";

describe("commit público del health", () => {
  test("prefiere el SHA de Vercel y lo deja en siete caracteres", () => {
    expect(publicCommit({ VERCEL_GIT_COMMIT_SHA: "4A32000be217a300b7c2f0e4ac4c25b702224697", BRAZO_BUILD_COMMIT: "aaaaaaa" })).toBe("4a32000");
  });

  test("si falta el de Vercel usa el valor grabado en el build", () => {
    expect(publicCommit({ BRAZO_BUILD_COMMIT: "94e7293" })).toBe("94e7293");
  });

  test("un valor que no es un SHA no sale", () => {
    const body = publicCommit({ VERCEL_GIT_COMMIT_SHA: "ghp_secreto", BRAZO_BUILD_COMMIT: "token=abc" });
    expect(body).toBe("desconocido");
    expect(body).not.toContain("ghp");
    expect(body).not.toContain("token");
  });
});

describe("favicon azul", () => {
  test("el icono de la app usa el azul de la marca", () => {
    const icon = readFileSync(new URL("../../src/app/icon.svg", import.meta.url), "utf8");
    expect(icon).toContain("#0b3a6e");
    expect(icon).toContain("#22c3e6");
    expect(icon).not.toContain("#14332d");
  });
});
