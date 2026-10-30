import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://brazo:brazo@127.0.0.1:5432/brazo_derecho";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next start -p ${port}`,
    url: `${baseURL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: process.env.DIRECT_URL ?? databaseUrl,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-session-secret-de-al-menos-32-caracteres",
      APP_URL: baseURL,
      XAI_MODE: "mock",
      XAI_API_KEY: "",
      FLOW_API_KEY: "",
      FLOW_SECRET_KEY: "",
      WHATSAPP_TOKEN: "",
      WHATSAPP_APP_SECRET: "",
      WHATSAPP_VERIFY_TOKEN: "",
      SENTRY_DSN: "",
      ADMIN_EMAILS: "admin-e2e@brazo.cl",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
