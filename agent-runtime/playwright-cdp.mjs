import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP(process.env.CDP_URL || "http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
for (const page of pages) {
  console.log(page.url());
}
await browser.close();
