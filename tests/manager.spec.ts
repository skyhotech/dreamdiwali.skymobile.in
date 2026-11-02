import { expect, test } from "@playwright/test";
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
test("manager checks a purchase, then gets the WhatsApp button", async ({ page }) => {
  await page.route("**/api/manager/branches/", (r) =>
    r.fulfill({
      json: [
        { slug: "anna-nagar", name: "Anna Nagar" },
        { slug: "t-nagar", name: "T Nagar" },
      ],
    }),
  );
  let bad = true;
  await page.route("**/api/manager/check/", (r) =>
    bad
      ? r.fulfill({
          status: 400,
          json: { imei: ["This IMEI is already registered."] },
        })
      : r.fulfill({
          json: { phone: "9845012345", link: "https://x.test/?spin=abc" },
        }),
  );
  await page.goto("/");
  await page.getByLabel("Passcode").fill("key");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Customer name").fill("Asha");
  await page.locator("#m-phone").fill("9845012345");
  await page.getByLabel("Product details").fill("Phone 15");
  await page.locator("#m-imei").fill("490154203237519");
  await page.getByLabel("Invoice number").fill("INV-1");
  await page.getByLabel("Bill value").fill("24999");
  await page.getByLabel("Branch").click();
  await page.getByLabel("Branch").fill("anna");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: "Anna Nagar" }).click();
  await page.locator("#m-image").setInputFiles({
    name: "invoice.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("alert").first()).toContainText("IMEI number is not valid");
  await page.locator("#m-imei").fill("490154203237518");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("alert").first()).toContainText("Data mismatch: This IMEI is already");
  bad = false;
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Send link in WhatsApp" })).toBeVisible();
  await page.locator("#m-imei").fill("490154203237");
  await expect(page.getByRole("button", { name: "Check" })).toBeVisible();
});
test("customer link opens the wheel before the camera", async ({ page }) => {
  await page.route("**/api/customers/link/abc/", (r) =>
    r.fulfill({ json: { phone: "9845012345", reward: null } }),
  );
  await page.goto("/?spin=abc");
  await expect(page.getByRole("button", { name: "Tap to spin" })).toBeVisible();
});
