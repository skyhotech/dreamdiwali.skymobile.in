import { expect, test } from "vitest";
import { invoiceMissing, sharpness } from "./invoiceScan";
test("the invoice number matches despite scanner mix-ups", () => {
  expect(invoiceMissing("Tax lNV-2041\nTotal", "INV-2041")).toEqual([]);
});
test("a wrong invoice number is named", () => {
  expect(invoiceMissing("Total 100", "Q7")).toEqual(["invoice number"]);
});
test("a flat image has no sharpness and hard edges have plenty", () => {
  const flat = new Float32Array(100).fill(128);
  const edges = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0));
  expect(sharpness(flat, 10, 10)).toBe(0);
  expect(sharpness(edges, 10, 10)).toBeGreaterThan(1000);
});
