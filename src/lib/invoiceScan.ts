// Document scanner for invoice photos: rejects blurry shots, reads every word
// with OCR on the device, and compares it with what the manager typed.
export const BLURRY = "Invoice photo is blurry. Please retake it.";
// Variance of the Laplacian at 1000 px; crisp print scores far above this.
const SHARPNESS_FLOOR = 50;
const SCAN_SIDE = 1000;
const ALIKE: Record<string, string> = { O: "0", I: "1", L: "1", S: "5", B: "8" };
// Letters a scanner confuses with digits count as the same character.
const compact = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OILSB]/g, (c) => ALIKE[c]);
// The value printed after the label, e.g. "Invoice No : SI2627VLR31054".
const INVOICE_LABEL = /invoice\s*(?:no|number|num)\b\s*[.:;\-]*\s*([A-Z0-9][A-Z0-9/\-]{3,})/i;
// Same idea for "IMEI NO: P-12568801-D"; a bill can list several.
const IMEI_LABEL = /(?:imei|serial)\s*(?:no|number|num)?\b\s*[.:;\-]*\s*([A-Z0-9][A-Z0-9\-]{3,})/gi;
/** True when the value printed at a label, or failing that anywhere, matches. */
function printed(text: string, labelled: string[], typed: string) {
  const want = compact(typed);
  return labelled.length
    ? labelled.some((v) => compact(v) === want)
    : want.length >= 4 && compact(text).includes(want);
}
const AMOUNT = /\d[\d,]*\.\d{2}|\d[\d,]*/g;
const money = (t: string) => Number(t.replace(/,/g, ""));
/** The Amount column of the Net Total row: the last figure on that line. */
function billAmount(text: string) {
  const row =
    text.match(/net\s*total[^\n]*/i)?.[0] ??
    text.match(/^(?!.*tax).*\btotal\b[^\n]*/im)?.[0] ??
    "";
  return row.match(AMOUNT)?.map(money).pop();
}
export type InvoiceFields = {
  name: string;
  phone: string;
  product: string;
  imei: string;
  invoice: string;
  bill: string;
};
/** Which typed details don't match the invoice. Each is read from its place
 *  on the bill, so any value or format works. Kept in sync with
 *  invoice_missing in backend/mirrors/serializers.py. */
export function invoiceMissing(text: string, f: InvoiceFields) {
  const missing = [];
  const billedAt = text.search(/billed\s*to/i);
  const billed = billedAt < 0 ? text : text.slice(billedAt);
  const nameLine = billed.split("\n").slice(1).find((l) => l.trim());
  if (!compact(nameLine ?? text).includes(compact(f.name)))
    missing.push("customer name");
  const phone = billed.match(/ph\w*\s*[.:;\-]*\s*((?:\+?91)?\d{10})/i)?.[1];
  if (phone ? !phone.endsWith(f.phone) : !text.includes(f.phone))
    missing.push("contact number");
  if (!compact(text).includes(compact(f.product))) missing.push("product details");
  const imeis = [...text.matchAll(IMEI_LABEL)].map((m) => m[1]);
  if (!printed(text, imeis, f.imei)) missing.push("IMEI");
  const number = text.match(INVOICE_LABEL)?.[1];
  if (!printed(text, number ? [number] : [], f.invoice))
    missing.push("invoice number");
  if (billAmount(text) !== Number(f.bill)) missing.push("bill value");
  return missing;
}
/** Variance of the Laplacian: edges vanish in a blurry photo, so it drops. */
export function sharpness(gray: Float32Array, w: number, h: number) {
  let sum = 0,
    squares = 0,
    n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += v;
      squares += v * v;
      n++;
    }
  return n ? squares / n - (sum / n) ** 2 : 0;
}
async function measure(file: Blob) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file isn't a readable image.");
  });
  const scale = Math.min(1, SCAN_SIDE / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const gray = new Float32Array(c.width * c.height);
  for (let i = 0; i < gray.length; i++)
    gray[i] =
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return sharpness(gray, c.width, c.height);
}
/** Refuses a blurry photo, otherwise returns all the text on it. */
export async function readInvoice(file: Blob) {
  const score = await measure(file);
  if (score < SHARPNESS_FLOOR) throw new Error(BLURRY);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return { text: data.text, sharpness: score };
  } finally {
    void worker.terminate();
  }
}
