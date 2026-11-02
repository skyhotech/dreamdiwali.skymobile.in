import { expect, test } from "vitest";
import { invoiceMissing, sharpness } from "./invoiceScan";
const BILL = "TAX INVOICE\nInvoice No : SI2627VLR31054 Invoice Date : 31/10/2026\nTotal 64,000.00";
test("the labelled invoice number matches, despite scanner mix-ups", () => {
  expect(invoiceMissing(BILL, "SI2627VLR31054")).toEqual([]);
  expect(invoiceMissing(BILL, "si2627vlr31054")).toEqual([]);
  expect(invoiceMissing(BILL.replace("SI26", "S126"), "SI2627VLR31054")).toEqual([]);
});
test("anything but the labelled number is refused", () => {
  expect(invoiceMissing(BILL, "SI2627VLR31055")).toEqual(["invoice number"]);
  expect(invoiceMissing(BILL, "64000")).toEqual(["invoice number"]);
});
test("without a label the number must appear somewhere", () => {
  expect(invoiceMissing("Bill SI2627VLR31054", "SI2627VLR31054")).toEqual([]);
  expect(invoiceMissing("Total 100", "Q7")).toEqual(["invoice number"]);
});
test("a flat image has no sharpness and hard edges have plenty", () => {
  const flat = new Float32Array(100).fill(128);
  const edges = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0));
  expect(sharpness(flat, 10, 10)).toBe(0);
  expect(sharpness(edges, 10, 10)).toBeGreaterThan(1000);
});
