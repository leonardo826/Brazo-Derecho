import { describe, expect, test } from "vitest";
import {
  parseInboundTexts,
  routeInbound,
  verifyMetaSignature,
  verifyWebhookChallenge,
  type PhoneOwner,
} from "@/lib/whatsapp/cloud";

const SECRET = "app-secret";
const BODY = '{"object":"whatsapp_business_account"}';
const SIGNATURE = "sha256=0bf7374433906636bed1653bc7c64affb42fa5da9a39e251ab95c2e3a9c06923";

const owners: PhoneOwner[] = [
  { id: "ferreteria", whatsappPhoneNumberId: "111111111111111" },
  { id: "cafe", whatsappPhoneNumberId: "222222222222222" },
];

function payload(phoneNumberId: string, body: string, type = "text") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: "56911112222", profile: { name: "Ana Pérez" } }],
              messages: [
                {
                  from: "56911112222",
                  id: "wamid.ABC",
                  type,
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("verificación del webhook de WhatsApp", () => {
  test("devuelve el challenge cuando el token coincide", () => {
    const result = verifyWebhookChallenge({
      mode: "subscribe",
      verifyToken: "token-de-braza",
      challenge: "12345",
      expectedToken: "token-de-braza",
    });
    expect(result).toEqual({ ok: true, challenge: "12345" });
  });

  test("rechaza un token distinto y exige el token configurado", () => {
    expect(
      verifyWebhookChallenge({
        mode: "subscribe",
        verifyToken: "otro",
        challenge: "12345",
        expectedToken: "token-de-braza",
      }).ok,
    ).toBe(false);
    expect(
      verifyWebhookChallenge({
        mode: "subscribe",
        verifyToken: "token-de-braza",
        challenge: "12345",
        expectedToken: null,
      }),
    ).toMatchObject({ ok: false, status: 503 });
  });

  test("la firma sha256 del cuerpo tiene que coincidir", () => {
    expect(verifyMetaSignature(BODY, SIGNATURE, SECRET)).toBe(true);
    expect(verifyMetaSignature(BODY, SIGNATURE, "otro-secreto")).toBe(false);
    expect(verifyMetaSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(`${BODY} `, SIGNATURE, SECRET)).toBe(false);
  });
});

describe("enrutado a la empresa", () => {
  test("el mensaje llega a la empresa dueña de ese phone number id", () => {
    const [message] = parseInboundTexts(payload("222222222222222", "¿A qué hora abren?"));
    const routed = routeInbound(message, owners);
    expect(routed?.organizationId).toBe("cafe");
    expect(routed?.message.body).toBe("¿A qué hora abren?");
    expect(routed?.message.name).toBe("Ana Pérez");
    expect(routed?.message.from).toBe("56911112222");
  });

  test("un número de otra empresa no se cruza y un id desconocido no entra", () => {
    const [message] = parseInboundTexts(payload("111111111111111", "Hola"));
    expect(routeInbound(message, owners)?.organizationId).toBe("ferreteria");
    expect(routeInbound(message, owners)?.organizationId).not.toBe("cafe");
    const [unknown] = parseInboundTexts(payload("999999999999999", "Hola"));
    expect(routeInbound(unknown, owners)).toBeNull();
  });

  test("ignora lo que no es texto", () => {
    expect(parseInboundTexts(payload("111111111111111", "audio", "audio"))).toEqual([]);
    expect(parseInboundTexts({ object: "page" })).toEqual([]);
  });
});
