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
/** Which typed details don't match the invoice: only the invoice number is
 *  compared, against the labelled value when the scanner found the label.
 *  Kept in sync with invoice_missing in backend/mirrors/serializers.py. */
export function invoiceMissing(text: string, invoice: string) {
  const labelled = text.match(INVOICE_LABEL)?.[1];
  const ok = labelled
    ? compact(labelled) === compact(invoice)
    : compact(invoice).length >= 4 && compact(text).includes(compact(invoice));
  return ok ? [] : ["invoice number"];
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
