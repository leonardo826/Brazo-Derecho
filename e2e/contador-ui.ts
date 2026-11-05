import { expect, type Page } from "@playwright/test";

export async function assertChatDock(page: Page) {
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Contador Auditor Chile" })).toBeVisible();
  await expect(page.getByText("Mensaje", { exact: true })).toHaveCount(0);
  await expect(page.locator(".usage-bar, .bar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancelar" })).toHaveCount(0);
  await expect(page.locator(".agent-composer .composer-actions")).toHaveCount(0);

  const log = page.getByRole("log", { name: "Mensajes" });
  // Next leaves a hidden copy of the HTML. Measure the visible bar.
  const bar = page.locator(".composer-bar:visible");
  await expect(log).toBeVisible();
  await expect(bar).toBeVisible();

  const logBox = await log.boundingBox();
  const barBox = await bar.boundingBox();
  expect(logBox).toBeTruthy();
  expect(barBox).toBeTruthy();
  expect(logBox!.height).toBeGreaterThan(160);
  expect(logBox!.y + logBox!.height).toBeLessThanOrEqual(barBox!.y + 4);
  expect(barBox!.height).toBeLessThan(90);
  expect(barBox!.y + barBox!.height).toBeGreaterThan(viewport!.height - 120);
  expect(barBox!.width).toBeGreaterThan(viewport!.width * 0.55);

  const attach = page.locator(".composer-bar:visible .file-button");
  const input = page.getByRole("textbox", { name: "Mensaje" });
  const mic = page.getByRole("button", { name: "Micrófono" });
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  await expect(attach).toBeVisible();
  await expect(input).toBeVisible();
  await expect(mic).toBeVisible();
  await expect(send).toBeVisible();

  const boxes = await Promise.all([attach.boundingBox(), input.boundingBox(), mic.boundingBox(), send.boundingBox()]);
  expect(boxes.every(Boolean)).toBe(true);
  const [attachBox, inputBox, micBox, sendBox] = boxes as NonNullable<(typeof boxes)[number]>[];
  const centers = [attachBox, inputBox, micBox, sendBox].map((box) => box.y + box.height / 2);
  const top = Math.min(...centers);
  const bottom = Math.max(...centers);
  expect(bottom - top).toBeLessThan(24);
  expect(attachBox.x).toBeLessThan(inputBox.x);
  expect(inputBox.x).toBeLessThan(micBox.x);
  expect(micBox.x).toBeLessThan(sendBox.x);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function assertBubbleSides(page: Page) {
  // The «escribiendo…» row is the last .agent-row.assistant and unmounts when the
  // answer is saved. getComputedStyle on that detached node returns "" in Chrome;
  // measure the saved bubble (it has «Escuchar»).
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(() => {
            const shown = (el: Element | null) => {
              if (!el?.isConnected) return false;
              const box = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            };
            const gaps = (row: Element) => {
              const bubble = row.querySelector(".agent-bubble");
              if (!bubble) return null;
              const rowBox = row.getBoundingClientRect();
              const bubbleBox = bubble.getBoundingClientRect();
              return {
                align: getComputedStyle(row).justifyContent,
                left: bubbleBox.left - rowBox.left,
                right: rowBox.right - bubbleBox.right,
              };
            };
            const user = [...document.querySelectorAll(".agent-row.user")].filter(shown).at(-1);
            const assistant = [...document.querySelectorAll(".agent-row.assistant")]
              .filter((el) => shown(el) && (el.textContent ?? "").includes("Respuesta de prueba") && el.querySelector("button"))
              .at(-1);
            if (!user || !assistant) return "pending";
            const userGap = gaps(user);
            const assistantGap = gaps(assistant);
            if (!userGap || !assistantGap) return "pending";
            if (userGap.align !== "flex-end") return `user:${userGap.align}`;
            if (assistantGap.align !== "flex-start") return `assistant:${assistantGap.align}`;
            if (assistantGap.left > 8) return `assistant-left:${assistantGap.left.toFixed(1)}`;
            if (userGap.right > 8) return `user-right:${userGap.right.toFixed(1)}`;
            return "ok";
          });
        } catch {
          return "pending";
        }
      },
      { timeout: 20_000 },
    )
    .toBe("ok");
}
