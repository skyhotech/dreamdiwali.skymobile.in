import { useState } from "react";
import { motion } from "motion/react";
import iphone from "../assets/brand/iphone15.webp";
import { acceptTerms } from "../lib/backend";
const HANDLE = "@skymobileandelectronics";
// After the spin, for customers who skipped the video review on the terms page.
export function IphoneOffer({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"ask" | "join">("ask");
  const [instagram, setInstagram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!instagram.trim()) return setError("Enter your Instagram ID.");
    setBusy(true);
    setError("");
    try {
      await acceptTerms(token, true, instagram.trim());
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <motion.div
      key={step}
      className="phone-card manager-card iphone-offer"
      initial={{ opacity: 0, scale: 0.9, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
    >
      <img className="iphone-offer-img" src={iphone} alt="iPhone 15" />
      {step === "ask" ? (
        <>
          <h1 className="phone-title">Do you really want to miss the chance of winning an iPhone 15?</h1>
          <div className="iphone-offer-actions">
            <button className="spin-button phone-continue iphone-no" onClick={() => setStep("join")}>
              No, I want to win!
            </button>
            <button className="text-button" onClick={onDone}>
              Yes, skip the chance
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void join(e)}>
          <h1 className="phone-title">Join the iPhone 15 contest</h1>
          <ol className="terms-list">
            <li>Record a short video review of the product you bought.</li>
            <li>Post it as an Instagram Reel and add {HANDLE} as a collaborator.</li>
            <li>Follow {HANDLE} and keep your account public until the winner is announced.</li>
            <li>The Reel with the highest views, likes and comments has a chance to win. Open to purchases above ₹10,000.</li>
            <li>Only organic views, likes and comments count. Paid or automated engagement is disqualified.</li>
          </ol>
          <label htmlFor="offer-instagram">Your Instagram ID</label>
          <input
            id="offer-instagram"
            className="manager-input"
            autoCapitalize="none"
            autoComplete="off"
            maxLength={31}
            placeholder="e.g. @yourname"
            value={instagram}
            onChange={(e) => {
              setInstagram(e.target.value.replace(/[^@A-Za-z0-9._]/g, ""));
              setError("");
            }}
            autoFocus
          />
          <p className="phone-help phone-help-error" role="alert">
            {error}
          </p>
          <button className="spin-button phone-continue" disabled={busy}>
            {busy ? "Submitting…" : "Submit"}
          </button>
        </form>
      )}
    </motion.div>
  );
}
