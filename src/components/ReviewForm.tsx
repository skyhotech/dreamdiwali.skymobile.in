import { useState } from "react";
import { Star } from "lucide-react";
import { motion } from "motion/react";
import { sendReview } from "../lib/backend";
const LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
// Between the prize and the mirror selfie: how was the visit?
export function ReviewForm({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return setError("Please choose a star rating.");
    setBusy(true);
    setError("");
    try {
      await sendReview(token, rating, review.trim());
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <motion.form
      className="phone-card review-card"
      onSubmit={(e) => void submit(e)}
      initial={{ opacity: 0, scale: 0.92, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
    >
      <h1 className="phone-title">How was your visit?</h1>
      <p>Rate SKY, then take your Diwali mirror selfie.</p>
      <div className="review-stars" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <motion.button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            whileTap={{ scale: 1.3 }}
            onClick={() => {
              setRating(n);
              setError("");
            }}
          >
            <Star
              size={40}
              fill={n <= rating ? "#f3b51b" : "none"}
              color={n <= rating ? "#d6a447" : "#c9b89a"}
            />
          </motion.button>
        ))}
      </div>
      <p className="review-label">{LABELS[rating] || "Tap a star"}</p>
      <label htmlFor="review-text">Your review</label>
      <textarea
        id="review-text"
        className="manager-input"
        rows={4}
        maxLength={1000}
        placeholder="Tell us about your purchase and our service"
        value={review}
        onChange={(e) => setReview(e.target.value)}
      />
      <p className="phone-help phone-help-error" role="alert">
        {error}
      </p>
      <button className="spin-button phone-continue" disabled={busy}>
        {busy ? "Submitting…" : "Submit"}
      </button>
    </motion.form>
  );
}
