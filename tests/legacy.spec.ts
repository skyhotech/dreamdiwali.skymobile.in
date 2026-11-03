import { expect, test } from "@playwright/test";
// Older phones (Chrome 94 on Android 11 sent these crash reports): without
// roundRect and AbortSignal.timeout the poster was black and requests failed.
test("the poster draws and requests work without newer browser features", async ({ page }) => {
  await page.addInitScript(() => {
    delete (CanvasRenderingContext2D.prototype as { roundRect?: unknown }).roundRect;
    delete (Path2D.prototype as { roundRect?: unknown }).roundRect;
    delete (AbortSignal as { timeout?: unknown }).timeout;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/customers/link/**", (r) =>
    r.fulfill({
      json: { phone: "9845012345", name: "Asha", reward: null, items: [], poster: null, next: "spin", video_review: true },
    }),
  );
  await page.goto("/?spin=old-phone");
  // The link request worked, and the wheel (drawn with rounded shapes) shows.
  await expect(page.getByRole("button", { name: "Tap to spin" })).toBeVisible();
  const drawn = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    ctx.beginPath();
    ctx.roundRect(1, 1, 20, 10, 4);
    ctx.fill();
    return ctx.getImageData(10, 5, 1, 1).data[3];
  });
  expect(drawn).toBe(255);
  expect(errors).toEqual([]);
});
