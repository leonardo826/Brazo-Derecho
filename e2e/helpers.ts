import { expect, type Locator, type Page } from "@playwright/test";

export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    if (!form) return document.readyState === "complete";
    return Object.keys(form).some((key) => key.startsWith("__reactProps") || key.startsWith("__reactFiber"));
  });
}

export async function clickHydrated(page: Page, button: Locator, seen: () => Promise<void>) {
  await expect(async () => {
    await waitForHydration(page);
    await button.click();
    await seen();
  }).toPass();
}
