import { connectTimeoutMillis, withConnectTimeout } from "@/lib/db-retry";

export function appUrl() {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

/** URL de la base con connect_timeout si no venía. No la registres: lleva la clave. */
export function databaseUrl() {
  const connectionString = process.env.DATABASE_URL?.trim() ?? "";
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  return withConnectTimeout(connectionString);
}

export function databaseConnectTimeoutMs() {
  return connectTimeoutMillis(databaseUrl());
}

export function whatsappEnv() {
  return {
    token: process.env.WHATSAPP_TOKEN?.trim() ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() ?? "",
  };
}
