import { expect, test } from "vitest";
import { extractInvoice, invoiceMissing, sharpness } from "./invoiceScan";
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
test("invoice number, IMEI and mobile number are compared", () => {
  expect(invoiceMissing(BILL, OK)).toEqual([]);
  // Name and bill value are not compared.
  expect(invoiceMissing(BILL, { ...OK, name: "Ravi", bill: "1" } as typeof OK)).toEqual([]);
  expect(invoiceMissing(BILL, { ...OK, imei: "P_12568801_D" })).toEqual([]);
  expect(invoiceMissing(BILL, { ...OK, imei: "12568801" })).toEqual([]);
  expect(invoiceMissing(BILL, { ...OK, imei: "P-99999999-D" })).toEqual(["IMEI"]);
  // The store's number at the top is not the customer's.
  expect(invoiceMissing(BILL, { ...OK, phone: "8754740002" })).toEqual(["mobile number"]);
});
test.each([
  ["invoice", "SI2627VLR31055", "invoice number"],
])("a wrong %s is named", (field, value, label) => {
  expect(invoiceMissing(BILL, { ...OK, [field]: value })).toEqual([label]);
});
test("an invoice fills in the form, and the result passes its own check", () => {
  const text = BILL.replace("SONY:LED", "SNo Particulars HSN/SAC Qty\n1 SONY:LED").replace(
    "LED TV\nIMEI",
    "LED TV 85287217 1 64,000.00\nIMEI",
  );
  const f = extractInvoice(text);
  expect(f).toEqual({
    storePhone: "8754740002",
    name: "M MAHENDRAN",
    phone: "9787372973",
    product: "SONY:LED TV:SONY (KD - 65X82L) 65INCH LED TV",
    imei: "P-12568801-D",
    invoice: "SI2627VLR31054",
    bill: "64000",
  });
  expect(invoiceMissing(text, f as typeof OK)).toEqual([]);
});
test("a flat image has no sharpness and hard edges have plenty", () => {
  const flat = new Float32Array(100).fill(128);
  const edges = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0));
  expect(sharpness(flat, 10, 10)).toBe(0);
  expect(sharpness(edges, 10, 10)).toBeGreaterThan(1000);
});
