import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Check, MessageCircle, ScanLine, X } from "lucide-react";
import skyLogo from "../assets/brand/sky.webp";
import { motion, useAnimationControls } from "motion/react";
import {
  ApiError,
  BRANCH,
  PHONE_PATTERN,
  checkPurchase,
  fetchManagerBranches,
  imeiValid,
  trackSent,
  type BranchOption,
} from "../lib/backend";
import { compressImage } from "../lib/images";
import { invoiceMissing, readInvoice } from "../lib/invoiceScan";
import { Festive } from "./Festive";
const ImeiScanner = lazy(() => import("./ImeiScanner"));
const MAX_INVOICE_BYTES = 250 * 1024;
const MISMATCH = "Data mismatch";
const EMPTY = {
  name: "",
  phone: "",
  email: "",
  product: "",
  imei: "",
  invoice: "",
  bill: "",
};
// First screen in the store: the manager records a purchase, and once it
// checks out sends the customer their spin link on WhatsApp.
export function ManagerIntake() {
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [branch, setBranch] = useState<BranchOption | null>(null);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("Checking…");
  const [link, setLink] = useState("");
  const [sent, setSent] = useState(false);
  const shake = useAnimationControls();
  const fail = useCallback(
    (message: string) => {
      setError(message);
      void shake.start({
        x: [0, -10, 10, -7, 7, -3, 0],
        transition: { duration: 0.45 },
      });
    },
    [shake],
  );
  useEffect(() => {
    let live = true;
    fetchManagerBranches()
      .then((list) => {
        if (!live) return;
        setBranches(list);
        // A branch QR code opens the page with its store selected.
        setBranch((b) => b ?? list.find((x) => x.slug === BRANCH) ?? null);
      })
      .catch((e: ApiError) => {
        if (!live) return;
        setBranches([]);
        fail(e.message);
      });
    return () => {
      live = false;
    };
  }, [fail]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (branches ?? []).filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, search]);
  // Any edit means the sent link no longer matches what was checked.
  function change(field: keyof typeof EMPTY, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setLink("");
    setSent(false);
    setError("");
  }
  const onScan = useCallback((imei: string) => {
    setForm((f) => ({ ...f, imei }));
    setScanning(false);
    setLink("");
    setError("");
    navigator.vibrate?.(120);
  }, []);
  function problem() {
    if (!form.name.trim()) return "Enter the customer name.";
    if (!PHONE_PATTERN.test(form.phone))
      return "Enter a valid 10-digit mobile number.";
    if (!form.product.trim()) return "Enter the product details.";
    if (!imeiValid(form.imei)) return "This IMEI number is not valid.";
    if (!form.invoice.trim()) return "Enter the invoice number.";
    if (!(Number(form.bill) >= 1)) return "Enter the bill value.";
    if (!branch) return "Select a branch.";
    if (!image) return "Upload the invoice image.";
    if (!image.type.startsWith("image/"))
      return "The invoice must be an image.";
    return "";
  }
  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const wrong = problem();
    if (wrong) return fail(`${MISMATCH}: ${wrong}`);
    setBusy(true);
    setError("");
    try {
      // The full-size photo is read, since compressing would cost accuracy.
      setStage("Scanning invoice…");
      const { text, sharpness } = await readInvoice(image!);
      const missing = invoiceMissing(text, form.imei, form.invoice, form.bill);
      if (missing.length) {
        fail(`${MISMATCH}: Invoice does not show this ${missing.join(" or ")}.`);
        return;
      }
      setStage("Checking…");
      // Compressed only once everything above has passed.
      const small = await compressImage(image!, MAX_INVOICE_BYTES);
      const body = new FormData();
      body.append("name", form.name.trim());
      body.append("phone", form.phone);
      body.append("email", form.email.trim());
      body.append("product_details", form.product.trim());
      body.append("imei", form.imei);
      body.append("invoice_number", form.invoice.trim());
      body.append("bill_value", form.bill);
      body.append("branch", branch!.slug);
      body.append("invoice_image", small, "invoice.jpg");
      body.append("ocr_text", text);
      body.append("blur_score", String(Math.round(sharpness)));
      const res = await checkPurchase(body);
      setLink(res.link);
    } catch (err) {
      const e = err as ApiError;
      fail(
        e.status === 400
          ? `${MISMATCH}: ${e.message}`
          : e.message,
      );
    } finally {
      setBusy(false);
      setStage("Checking…");
    }
  }
  function sendWhatsapp() {
    const text = `Hi ${form.name.trim()}, thank you for shopping at SKY Mobile & Electronics! 🪔 Spin the wheel for your Diwali gift: ${link}`;
    window.open(
      `https://wa.me/91${form.phone}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    trackSent(form.phone);
    setSent(true);
  }
  function next() {
    setForm(EMPTY);
    setImage(null);
    setLink("");
    setSent(false);
  }
  const field = (
    id: keyof typeof EMPTY,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <>
      <label htmlFor={`m-${id}`}>{label}</label>
      <input
        id={`m-${id}`}
        className="manager-input"
        value={form[id]}
        onChange={(e) => change(id, e.target.value)}
        {...props}
      />
    </>
  );
  return (
    <Festive>
      <motion.div animate={shake} className="phone-shake">
        <motion.form
          className="phone-card manager-card"
          onSubmit={(e) => void check(e)}
          initial={{ opacity: 0, scale: 0.92, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          noValidate
        >
          <div className="phone-logo">
            <img src={skyLogo} alt="SKY Mobile & Electronics" />
          </div>
          <h1 className="phone-title">Customer details</h1>
          {field("name", "Customer name", { maxLength: 80, autoComplete: "off" })}
          <label htmlFor="m-phone">Customer contact number</label>
          <div className="phone-field">
            <span>+91</span>
            <input
              id="m-phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={form.phone}
              onChange={(e) =>
                change("phone", e.target.value.replace(/\D/g, "").slice(0, 10))
              }
            />
          </div>
          {field("email", "Mail ID (optional)", {
            type: "email",
            inputMode: "email",
            autoComplete: "off",
          })}
          {field("product", "Product details", { maxLength: 160 })}
          <label htmlFor="m-imei">IMEI number</label>
          <div className="manager-row">
            <input
              id="m-imei"
              className="manager-input"
              inputMode="numeric"
              maxLength={15}
              placeholder="Type or scan"
              value={form.imei}
              onChange={(e) =>
                change("imei", e.target.value.replace(/\D/g, ""))
              }
            />
            <button
              type="button"
              className="manager-scan"
              aria-expanded={scanning}
              onClick={() => setScanning((v) => !v)}
            >
              {scanning ? <X size={18} /> : <ScanLine size={18} />}
              {scanning ? "Close" : "Scan"}
            </button>
          </div>
          {scanning && (
            <Suspense fallback={<p className="phone-help">Opening camera…</p>}>
              <ImeiScanner onScan={onScan} />
            </Suspense>
          )}
          {field("invoice", "Invoice number", { maxLength: 40 })}
          {field("bill", "Bill value (₹)", {
            type: "number",
            inputMode: "decimal",
            min: 1,
            step: "0.01",
          })}
          <label htmlFor="m-branch">Branch</label>
          <div className="manager-branch">
            <input
              id="m-branch"
              className="manager-input"
              role="combobox"
              aria-expanded={picking}
              aria-controls="m-branch-list"
              autoComplete="off"
              placeholder="Search branch"
              value={picking ? search : (branch?.name ?? "")}
              onFocus={() => {
                setSearch("");
                setPicking(true);
              }}
              onBlur={() => setPicking(false)}
              onChange={(e) => setSearch(e.target.value)}
            />
            {picking && (
              <ul id="m-branch-list" className="manager-options" role="listbox">
                {matches.map((b) => (
                  <li
                    key={b.slug}
                    role="option"
                    aria-selected={b.slug === branch?.slug}
                    // Before the input's blur closes this list.
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setBranch(b);
                      setPicking(false);
                      setLink("");
                    }}
                  >
                    {b.name}
                  </li>
                ))}
                {!matches.length && <li>No branch found</li>}
              </ul>
            )}
          </div>
          <label htmlFor="m-image">Upload invoice image</label>
          <input
            id="m-image"
            className="manager-input"
            type="file"
            accept="image/*"
            onChange={(e) => {
              setImage(e.target.files?.[0] ?? null);
              setLink("");
              setError("");
            }}
          />
          <p className="phone-help phone-help-error" role="alert">
            {error}
          </p>
          {link ? (
            <>
              <button
                type="button"
                className="spin-button phone-continue manager-whatsapp"
                onClick={sendWhatsapp}
              >
                {sent ? <Check size={18} /> : <MessageCircle size={18} />}
                {sent ? "Send again in WhatsApp" : "Send link in WhatsApp"}
              </button>
              {sent && (
                <button type="button" className="text-button" onClick={next}>
                  Next customer
                </button>
              )}
            </>
          ) : (
            <button className="spin-button phone-continue" disabled={busy}>
              {busy ? stage : "Check"}
            </button>
          )}
        </motion.form>
      </motion.div>
    </Festive>
  );
}
