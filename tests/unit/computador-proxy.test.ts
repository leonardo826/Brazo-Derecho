import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { proxy } from "@/proxy";

describe("el computador apagado", () => {
  test("responde 404 antes de la página aunque la petición traiga sesión", async () => {
    const previous = process.env.COMPUTER_FEATURE_ENABLED;
    delete process.env.COMPUTER_FEATURE_ENABLED;
    const response = proxy(
      new NextRequest("http://localhost/panel/computador", {
        headers: { cookie: "bd_session=sesion-valida" },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("No está esta página");
    if (previous === undefined) delete process.env.COMPUTER_FEATURE_ENABLED;
    else process.env.COMPUTER_FEATURE_ENABLED = previous;
  });
});
