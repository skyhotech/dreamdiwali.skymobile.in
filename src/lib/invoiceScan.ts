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
const IMEI_LABEL = /(?:imei|serial)\s*(?:no|number|num)?\b\s*[.:;\-]*\s*([A-Z0-9][A-Z0-9_\-]{3,})/gi;
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
/** Whether the typed IMEI and invoice number match the bill; other fields are
 *  not compared. Each is read from its place, so any value or format works. Kept in sync with
 *  invoice_missing in backend/mirrors/serializers.py. */
export function invoiceMissing(
  text: string,
  f: Pick<InvoiceFields, "imei" | "invoice">,
) {
  const missing = [];
  const imeis = [...text.matchAll(IMEI_LABEL)].map((m) => m[1]);
  // P-12568801-D, P_12568801_D and 12568801 are the same serial.
  const want = compact(f.imei);
  const same = (v: string) => compact(v).includes(want) || want.includes(compact(v));
  if (imeis.length ? !imeis.some(same) : !printed(text, [], f.imei))
    missing.push("IMEI");
  const number = text.match(INVOICE_LABEL)?.[1];
  if (!printed(text, number ? [number] : [], f.invoice))
    missing.push("invoice number");
  return missing;
}
/** The customer details printed on an invoice, for filling in the form. */
export function extractInvoice(text: string): Partial<InvoiceFields> {
  const lines = text.split("\n").map((l) => l.replace(/[|\[\]]/g, " ").trim());
  const billedAt = lines.findIndex((l) => /billed\s*to/i.test(l));
  // Billed To and Shipped To sit side by side, so a name can appear twice.
  const after = billedAt < 0 ? [] : lines.slice(billedAt + 1).filter(Boolean);
  const words = (after[0] ?? "").split(/\s+/);
  const half = words.length / 2;
  const twice =
    half % 1 === 0 && words.slice(0, half).join(" ") === words.slice(half).join(" ");
  const name = (twice ? words.slice(0, half) : words).join(" ");
  const phone = after
    .join("\n")
    .match(/ph\w*\s*[.:;\-]*\s*(?:\+?91)?(\d{10})/i)?.[1];
  const header = lines.findIndex((l) => /particulars/i.test(l));
  const product = lines
    .slice(header + 1)
    .find((l, i) => header >= 0 && i < 4 && /[a-z]{3}/i.test(l))
    ?.replace(/^\d+\s+/, "")
    .replace(/\s+\d{6,8}\b.*$/, "")
    .trim();
  const bill = billAmount(text);
  return {
    name: name || undefined,
    phone,
    product,
    imei: [...text.matchAll(IMEI_LABEL)][0]?.[1].toUpperCase(),
    invoice: text.match(INVOICE_LABEL)?.[1],
    bill: bill ? String(bill) : undefined,
  };
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
type TextPiece = { str: string; transform: number[] };
// A PDF made by billing software holds its words: reading them is instant and
// exact. Scanned PDFs hold only a picture, so they go through OCR instead.
const MIN_PDF_TEXT = 40;
const LINE_TOLERANCE = 4;
async function loadPdf() {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}
export async function readPdf(file: Blob) {
  const pdfjs = await loadPdf();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const page = await (await task.promise).getPage(1);
    const pieces = (await page.getTextContent()).items.filter(
      (i): i is TextPiece & typeof i => "str" in i && Boolean(i.str.trim()),
    );
    // Top to bottom, then left to right, joining pieces on one printed line.
    pieces.sort(
      (a, b) =>
        b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
    );
    const lines: { y: number; parts: typeof pieces }[] = [];
    for (const p of pieces) {
      const line = lines.find(
        (l) => Math.abs(l.y - p.transform[5]) < LINE_TOLERANCE,
      );
      if (line) line.parts.push(p);
      else lines.push({ y: p.transform[5], parts: [p] });
    }
    const text = lines
      .map((l) =>
        l.parts
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((p) => p.str.trim())
          .join(" "),
      )
      .join("\n");
    return text.length >= MIN_PDF_TEXT ? text : "";
  } finally {
    void task.destroy();
  }
}
/** First page of a PDF as a sharp image. Runs on this device only: the PDF
 *  is held in memory for the check and never uploaded. */
export async function pdfToImage(file: Blob) {
  const pdfjs = await loadPdf();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not read this PDF."))),
        "image/png",
      ),
    );
  } finally {
    void task.destroy();
  }
}
