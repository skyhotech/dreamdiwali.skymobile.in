import { expect, test, type Page } from "@playwright/test";
// The manager's form, with a real PDF invoice read on the device.
const INVOICE = "tests/fixtures/invoice.pdf";
// What Django reads from the fixture invoice (mirrors/extract.py).
const READING = [
  "SKY WORLD",
  "VELAPADI,VELLORE-632001 Ph: 8754740002",
  "TAX INVOICE",
  "Invoice No : SI2627VLR31054   Invoice Date : 31/10/2026",
  "Billed To,",
  "M MAHENDRAN",
  "Ph: 9787372973",
  "SNo Particulars HSN/SAC Qty",
  "1 SONY LED TV 85287217 1 64,000.00",
  "IMEI NO: 490154203237518",
  "Net Total 1 64,000.00",
].join("\n");
async function openForm(page: Page) {
  await page.route("**/api/manager/scan/", (r) =>
    r.fulfill({ json: { scan: "scan-123", text: READING } }),
  );
  await page.route("**/api/live/", (r) => r.fulfill({ status: 204 }));
  await page.route("**/api/manager/branches/", (r) =>
    r.fulfill({
      json: [
        { slug: "arni-1", name: "ARNI-1", phone: "8754750009" },
        { slug: "arcot", name: "ARCOT", phone: "9361373727" },
        { slug: "vellore-3", name: "VELLORE-3", phone: "8754740002" },
      ],
    }),
  );
  await page.goto("/");
}
async function chooseBranch(page: Page, name: string) {
  await page.getByLabel("Branch").click();
  await page.getByRole("option", { name }).click();
}

test("a PDF invoice fills the form, passes the check and offers WhatsApp", async ({ page }) => {
  let sent: string | null = null;
  await page.route("**/api/manager/check/", (r) => {
    sent = r.request().postData();
    return r.fulfill({ json: { phone: "9787372973", link: "https://x.test/?spin=abc" } });
  });
  await openForm(page);
  await page.locator("#m-image").setInputFiles(INVOICE);
  await expect(page.getByLabel("Customer name")).toHaveValue("M MAHENDRAN", { timeout: 20_000 });
  await expect(page.locator("#m-phone")).toHaveValue("9787372973");
  // A phone's bill: the IMEI field appears, filled in.
  await expect(page.locator("#m-imei")).toHaveValue("490154203237518");
  await expect(page.getByLabel("Invoice number")).toHaveValue("SI2627VLR31054");
  // Never filled from the bill: the manager types it.
  await expect(page.getByLabel("Bill value")).toHaveValue("");
  await page.getByLabel("Bill value").fill("64000");
  // The branch is always the manager's own choice.
  await expect(page.getByLabel("Branch")).toHaveValue("");
  await chooseBranch(page, "ARNI-1");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Send link in WhatsApp" })).toBeVisible();
  expect(sent).toContain("SI2627VLR31054");
  // Django checks its own reading, found by the scan id: no text from the phone.
  expect(sent).toContain("scan-123");
  expect(sent).not.toContain("ocr_text");
});

test("Django's mismatch verdict is shown, with the scan sent for checking", async ({ page }) => {
  let sent = "";
  await page.route("**/api/manager/check/", (r) => {
    sent = r.request().postData() ?? "";
    return r.fulfill({
      status: 400,
      json: { invoice_image: ["Invoice does not show this invoice number."] },
    });
  });
  await openForm(page);
  await page.locator("#m-image").setInputFiles(INVOICE);
  await expect(page.getByLabel("Invoice number")).toHaveValue("SI2627VLR31054", { timeout: 20_000 });
  await page.getByLabel("Invoice number").fill("SI2627VLR31099");
  await page.getByLabel("Bill value").fill("64000");
  await chooseBranch(page, "ARCOT");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Data mismatch: Invoice does not show this invoice number.",
  );
  // The phone no longer judges: Django compares its own reading.
  expect(sent).toContain("SI2627VLR31099");
  expect(sent).toContain("scan-123");
});

test("a chosen branch can be changed", async ({ page }) => {
  await openForm(page);
  await chooseBranch(page, "ARCOT");
  await expect(page.getByLabel("Branch")).toHaveValue("ARCOT");
  await chooseBranch(page, "ARNI-1");
  await expect(page.getByLabel("Branch")).toHaveValue("ARNI-1");
});

test("a bill below ₹10,000 gets no link and an explanation window", async ({ page }) => {
  let checked = false;
  await page.route("**/api/manager/check/", (r) => ((checked = true), r.fulfill({ json: {} })));
  await openForm(page);
  await page.locator("#m-image").setInputFiles(INVOICE);
  await expect(page.getByLabel("Invoice number")).toHaveValue("SI2627VLR31054", { timeout: 20_000 });
  await page.getByLabel("Bill value").fill("9999");
  await chooseBranch(page, "ARCOT");
  await page.getByRole("button", { name: "Check" }).click();
  const notice = page.getByRole("alertdialog", { name: "Not eligible for the spin wheel" });
  await expect(notice).toContainText("below ₹10,000");
  await expect(notice).toContainText("₹9,999");
  await notice.getByRole("button", { name: "OK" }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send link in WhatsApp" })).toHaveCount(0);
  expect(checked).toBe(false);
});

test("a bill without a phone IMEI hides the IMEI field", async ({ page }) => {
  await openForm(page);
  // Registered after openForm's own reading, so this TV bill wins.
  await page.route("**/api/manager/scan/", (r) =>
    r.fulfill({ json: { scan: "scan-tv", text: READING.replace("490154203237518", "P-12568801-D") } }),
  );
  await page.locator("#m-image").setInputFiles(INVOICE);
  await expect(page.getByLabel("Invoice number")).toHaveValue("SI2627VLR31054", { timeout: 20_000 });
  await expect(page.locator("#m-imei")).toHaveCount(0);
  await expect(page.getByText("Use camera")).toHaveCount(0);
});
