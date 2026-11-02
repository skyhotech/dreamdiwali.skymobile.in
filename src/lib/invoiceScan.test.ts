import { expect, test } from "vitest";
import { invoiceMissing, sharpness } from "./invoiceScan";
const BILL = `SKY WORLD
VELAPADI,VELLORE-632001 Ph: 8754740002
Invoice No : SI2627VLR31054 Invoice Date : 31/10/2026
Billed To, Shipped To,
M MAHENDRAN M MAHENDRAN
Ph: 9787372973 Ph: 9787372973
SONY:LED TV:SONY (KD - 65X82L) 65INCH LED TV
IMEI NO: P-12568801-D
Total 64,000.00
Round Off(-) 0.01
Net Total 1 64,000.00
Total 4,881.36 4,881.36 9,762.71`;
const OK = {
  name: "M Mahendran",
  phone: "9787372973",
  product: "SONY (KD - 65X82L)",
  imei: "P-12568801-D",
  invoice: "SI2627VLR31054",
  bill: "64000",
};
test("every field is read from its place on the bill", () => {
  expect(invoiceMissing(BILL, OK)).toEqual([]);
});
test.each([
  ["name", "Ravi", "customer name"],
  ["phone", "8754740002", "contact number"],
  ["product", "iPhone 15", "product details"],
  ["imei", "P-12568802-D", "IMEI"],
  ["invoice", "SI2627VLR31055", "invoice number"],
  ["bill", "9762.71", "bill value"],
])("a wrong %s is named", (field, value, label) => {
  expect(invoiceMissing(BILL, { ...OK, [field]: value })).toEqual([label]);
});
test("a flat image has no sharpness and hard edges have plenty", () => {
  const flat = new Float32Array(100).fill(128);
  const edges = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0));
  expect(sharpness(flat, 10, 10)).toBe(0);
  expect(sharpness(edges, 10, 10)).toBeGreaterThan(1000);
});
