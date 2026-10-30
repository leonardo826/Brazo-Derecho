import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://brazo:brazo@127.0.0.1:5432/brazo_derecho",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "dev-only-session-secret-cambia-esto-32",
      XAI_MODE: process.env.XAI_MODE ?? "mock",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
