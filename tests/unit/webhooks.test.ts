import { afterEach, describe, expect, test } from "vitest";
import { POST as flowPost } from "@/app/api/flow/confirmacion/route";
import { POST as whatsappPost } from "@/app/api/whatsapp/route";

function formRequest(url: string, params: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}

afterEach(() => {
  delete process.env.FLOW_API_KEY;
  delete process.env.FLOW_SECRET_KEY;
  delete process.env.FLOW_API_URL;
  delete process.env.WHATSAPP_APP_SECRET;
});

describe("POST /api/flow/confirmacion", () => {
  test("sin claves de Flow no procesa el aviso", async () => {
    const response = await flowPost(formRequest("http://localhost/api/flow/confirmacion", { token: "TOK123" }));
    expect(response.status).toBe(503);
  });

  test("rechaza una firma HMAC que no calza", async () => {
    process.env.FLOW_API_KEY = "api-key";
    process.env.FLOW_SECRET_KEY = "super-secret";
    const response = await flowPost(
      formRequest("http://localhost/api/flow/confirmacion", { token: "TOK123", s: "firma-falsa" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
  });

  test("rechaza un estado de pago pegado al aviso sin firma", async () => {
    process.env.FLOW_API_KEY = "api-key";
    process.env.FLOW_SECRET_KEY = "super-secret";
    const response = await flowPost(
      formRequest("http://localhost/api/flow/confirmacion", { token: "TOK123", status: "2" }),
    );
    expect(response.status).toBe(401);
  });
});

describe("POST /api/whatsapp", () => {
  test("sin el secreto de la app no procesa", async () => {
    const response = await whatsappPost(
      new Request("http://localhost/api/whatsapp", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(503);
  });

  test("rechaza X-Hub-Signature-256 inválida o ausente", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    const body = '{"object":"whatsapp_business_account"}';
    const invalid = await whatsappPost(
      new Request("http://localhost/api/whatsapp", {
        method: "POST",
        body,
        headers: { "x-hub-signature-256": "sha256=0000" },
      }),
    );
    expect(invalid.status).toBe(401);

    const missing = await whatsappPost(
      new Request("http://localhost/api/whatsapp", { method: "POST", body }),
    );
    expect(missing.status).toBe(401);
  });
});
