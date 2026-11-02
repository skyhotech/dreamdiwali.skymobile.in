import { expect, test } from "vitest";
import { invoiceMissing, sharpness } from "./invoiceScan";
test("matching details pass despite commas and scanner mix-ups", () => {
  const text = "Tax lNV-2041\nIMEI: 49O154 203237518\nTotal Rs 24,999.00";
  expect(invoiceMissing(text, "490154203237518", "INV-2041", "24999")).toEqual([]);
});
test("each wrong detail is named", () => {
  expect(invoiceMissing("Total 100", "490154203237518", "Q7", "24999")).toEqual([
    "IMEI",
    "invoice number",
    "bill value",
  ]);
});
test("a flat image has no sharpness and hard edges have plenty", () => {
  const flat = new Float32Array(100).fill(128);
  const edges = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0));
  expect(sharpness(flat, 10, 10)).toBe(0);
  expect(sharpness(edges, 10, 10)).toBeGreaterThan(1000);
});
