import { imeiValid } from "./backend";
// Invoice photos: blurry shots are refused here, before upload. Django reads
// the text (mirrors/extract.py) and checks it; this file fills in the form
// from that reading.
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
// A well-read figure: 34,038.00 or 34038.00. Scans of table rows often lose
// the separators (3403800), so only these are trusted.
const CLEAN_AMOUNT = /^\d{1,3}(?:,\d{2,3})*\.\d{2}$|^\d+\.\d{2}$/;
const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, lakh: 100_000, lakhs: 100_000, crore: 10_000_000 };
/** "Sixty Four Thousand Thirty Eight" → 64038; NaN if a word is unknown. */
export function wordsToNumber(words: string) {
  let total = 0,
    part = 0;
  for (const w of words.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)) {
    if (w === "and" || w === "only" || w === "rupees") continue;
    if (UNITS.includes(w)) part += UNITS.indexOf(w);
    else if (TENS.includes(w)) part += TENS.indexOf(w) * 10;
    else if (w === "hundred") part *= 100;
    else if (SCALES[w]) {
      total += part * SCALES[w];
      part = 0;
    } else return NaN;
  }
  return total + part;
}
/** The bill: the Net Total row's Amount; when a scan garbles that row, the
 *  payment lines added up, then the amount written in words. */
function billAmount(text: string) {
  const row =
    text.match(/net\s*total[^\n]*/i)?.[0] ??
    text.match(/^(?!.*tax).*\btotal\b[^\n]*/im)?.[0] ??
    "";
  const last = row.match(AMOUNT)?.pop();
  if (last && CLEAN_AMOUNT.test(last)) return money(last);
  const paid = text.match(/payment\s*info[^\n]*/i)?.[0].match(/\d[\d,]*\.\d{2}/g);
  if (paid?.length) return paid.map(money).reduce((a, b) => a + b, 0);
  const words = text.match(/amount\s*in\s*words\s*[:;.\-]*\s*([a-z ]+)/i)?.[1];
  const value = words ? wordsToNumber(words) : NaN;
  return value > 0 ? value : last ? money(last) : undefined;
}
/** 15-digit runs that pass the IMEI check: on a bill these can only be a
 *  phone's IMEI, whatever a scan made of the "IMEI NO" label. */
export function luhnImeis(text: string) {
  return (text.match(/(?<!\d)\d{15}(?!\d)/g) ?? []).filter(imeiValid);
}
export type InvoiceFields = {
  name: string;
  phone: string;
  product: string;
  imei: string;
  invoice: string;
  bill: string;
};
/** The customer details printed on an invoice, for filling in the form. */
export function extractInvoice(
  text: string,
): Partial<InvoiceFields> & { storePhone?: string } {
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
  // The item line follows the table header; if a scan garbled that, it
  // follows the last "Place of Supply" line of the Billed To block.
  let header = lines.findIndex((l) => /particulars/i.test(l));
  for (let i = lines.length - 1; header < 0 && i >= 0; i--)
    if (/place\s*of\s*supply/i.test(lines[i])) header = i;
  const product = lines
    .slice(header + 1)
    .find((l, i) => header >= 0 && i < 4 && /[a-z]{3}/i.test(l) && !/imei|serial/i.test(l))
    ?.replace(/^\d+\s+/, "")
    .replace(/\s+\d{6,8}\b.*$/, "")
    .trim();
  const bill = billAmount(text);
  // The store's own number sits above Billed To: it identifies the branch.
  const top = billedAt < 0 ? "" : text.slice(0, text.search(/billed\s*to/i));
  const storePhone = top.match(/ph\w*\s*[.:;\-]*\s*(?:\+?91)?(\d{10})/i)?.[1];
  return {
    storePhone,
    name: name || undefined,
    phone,
    product,
    imei:
      [...text.matchAll(IMEI_LABEL)][0]?.[1].toUpperCase() ?? luhnImeis(text)[0],
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
/** Refuses a blurry photo before it is uploaded; PDFs are always sharp. */
export async function checkSharpness(file: Blob) {
  if (file.type === "application/pdf") return PDF_SHARPNESS;
  const score = await measure(file);
  if (score < SHARPNESS_FLOOR) throw new Error(BLURRY);
  return score;
}
// Text inside a PDF can't be blurry; recorded as a clearly sharp score.
const PDF_SHARPNESS = 9999;
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
