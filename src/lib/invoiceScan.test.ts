import { expect, test } from "vitest";
import { extractInvoice, sharpness, wordsToNumber } from "./invoiceScan";
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
// What a manager would type for BILL.
const OK = {
  name: "M Mahendran",
  phone: "9787372973",
  product: "SONY (KD - 65X82L)",
  imei: "P-12568801-D",
  invoice: "SI2627VLR31054",
  bill: "64000",
};
test("a flat image has no sharpness and hard edges have plenty", () => {
  const flat = new Float32Array(100).fill(128);
  const edges = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0));
  expect(sharpness(flat, 10, 10)).toBe(0);
  expect(sharpness(edges, 10, 10)).toBeGreaterThan(1000);
});

// What the scanner really read from an image-only PDF (1.pdf): the IMEI label
// came out as "IEE NO" and the Net Total row lost its separators.
const SCANNED = `SKY WORLD
,LARANI-632301 Ph: 8754750009/9842320212
TAX INVOICE Original Copy,
Invoice No : SI2627A14813 Invoice Date : 02/11/2026
Billed To, Shipped To,
VENKATESAN VENKATESAN
Ph: 8675091127 Ph: 8675091127
GSTIN : -NA- Place of Supply :33-TAMIL NADU GSTIN : -NA- Place of Supply :33-TAMIL NADU
OPPO:SMART MOBILE:OPPO F35 5G (6GB+128GB) GREY MOBILE
IEE NO: 864714085807296 85171300 sooo 19 38,999.00
rr 0000 Ne%ew| [| af | [| 3403800
Amount in Words : Thirty Four Thousand Thirty Eight
Payment Info : Card : 34,038.00,`;
test("an invoice fills the form", () => {
  const text = BILL.replace("SONY:LED", "SNo Particulars HSN/SAC Qty\n1 SONY:LED").replace(
    "LED TV\nIMEI",
    "LED TV 85287217 1 64,000.00\nIMEI",
  );
  expect(extractInvoice(text)).toEqual({
    storePhone: "8754740002",
    name: "M MAHENDRAN",
    phone: "9787372973",
    product: "SONY:LED TV:SONY (KD - 65X82L) 65INCH LED TV",
    imei: "P-12568801-D",
    invoice: "SI2627VLR31054",
    bill: "64000",
  });
});
test("a scanned bill still gives the IMEI and product", () => {
  expect(extractInvoice(SCANNED)).toMatchObject({
    name: "VENKATESAN",
    phone: "8675091127",
    imei: "864714085807296",
    invoice: "SI2627A14813",
    product: "OPPO:SMART MOBILE:OPPO F35 5G (6GB+128GB) GREY MOBILE",
  });
});
test("amounts in words", () => {
  expect(wordsToNumber("Thirty Four Thousand Thirty Eight")).toBe(34038);
  expect(wordsToNumber("Sixty Four Thousand")).toBe(64000);
  expect(wordsToNumber("One Lakh Twenty Thousand Five Hundred Only")).toBe(120500);
});
