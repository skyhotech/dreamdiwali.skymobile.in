import { expect, test } from "vitest";
import { invoiceMissing, sharpness } from "./invoiceScan";
const BILL =
  "TAX INVOICE\nInvoice No : SI2627VLR31054 Invoice Date : 31/10/2026\nSONY LED TV\nIMEI NO: P-12568801-D\nTotal 64,000.00";
const SERIAL = "P-12568801-D";
test("values are read from their labels, whatever they are", () => {
  expect(invoiceMissing(BILL, SERIAL, "SI2627VLR31054")).toEqual([]);
  expect(invoiceMissing(BILL, "p12568801d", "si2627vlr31054")).toEqual([]);
  const other = BILL.replace("SI2627VLR31054", "AB/99-77").replace(SERIAL, "490154203237518");
  expect(invoiceMissing(other, "490154203237518", "AB/99-77")).toEqual([]);
});
test("a value that differs from the label is named", () => {
  expect(invoiceMissing(BILL, SERIAL, "SI2627VLR31055")).toEqual(["invoice number"]);
  expect(invoiceMissing(BILL, "P-12568802-D", "SI2627VLR31054")).toEqual(["IMEI"]);
});
test("any listed IMEI counts, and no label falls back to the page", () => {
  const two = "IMEI 1: 490154203237518\nIMEI 2: 356938035643809";
  expect(invoiceMissing(two + " INV-77", "356938035643809", "INV-77")).toEqual([]);
  expect(invoiceMissing("Total 100", "Q7Q7", "Q7")).toEqual(["invoice number", "IMEI"]);
});
test("a flat image has no sharpness and hard edges have plenty", () => {
  const flat = new Float32Array(100).fill(128);
  const edges = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0));
  expect(sharpness(flat, 10, 10)).toBe(0);
  expect(sharpness(edges, 10, 10)).toBeGreaterThan(1000);
});
