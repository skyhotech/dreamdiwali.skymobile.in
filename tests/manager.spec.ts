import { expect, test, type Page } from "@playwright/test";
// The manager's form, with a real PDF invoice read on the device.
const INVOICE = "tests/fixtures/invoice.pdf";
async function openForm(page: Page) {
  await page.route("**/api/live/", (r) => r.fulfill({ status: 204 }));
  await page.route("**/api/manager/branches/", (r) =>
    r.fulfill({ json: [{ slug: "arni-1", name: "ARNI-1" }, { slug: "arcot", name: "ARCOT" }] }),
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
  await expect(page.locator("#m-imei")).toHaveValue("P-12568801-D");
  await expect(page.getByLabel("Invoice number")).toHaveValue("SI2627VLR31054");
  await expect(page.getByLabel("Bill value")).toHaveValue("64000");
  await chooseBranch(page, "ARNI-1");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Send link in WhatsApp" })).toBeVisible();
  expect(sent).toContain("SI2627VLR31054");
  expect(sent).not.toContain("%PDF"); // the PDF itself is never uploaded
});

test("an invoice number that differs from the bill is a data mismatch", async ({ page }) => {
  let checked = false;
  await page.route("**/api/manager/check/", (r) => ((checked = true), r.fulfill({ json: {} })));
  await openForm(page);
  await page.locator("#m-image").setInputFiles(INVOICE);
  await expect(page.getByLabel("Invoice number")).toHaveValue("SI2627VLR31054", { timeout: 20_000 });
  await page.getByLabel("Invoice number").fill("SI2627VLR31099");
  await chooseBranch(page, "ARCOT");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("alert").first()).toContainText("Data mismatch");
  await expect(page.getByRole("alert").first()).toContainText("invoice number");
  expect(checked).toBe(false);
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
  await expect(page.getByLabel("Bill value")).toHaveValue("64000", { timeout: 20_000 });
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
