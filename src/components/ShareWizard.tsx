import { useState } from "react";
import { Check, Facebook, Gift, Instagram, MessageCircle, Share2, X } from "lucide-react";
import { motion } from "motion/react";
import { savePostLink, saveProfile, trackShare, unlockGift } from "../lib/backend";
import { getReward } from "../lib/rewards";
import { copyCaption, sharePoster } from "../lib/sharing";
import { useStudio } from "../lib/store";
import { shareOnWhatsapp } from "./WhatsAppShare";
type Step = "id" | "instagram" | "whatsapp" | "more" | "gift";
const STEPS: Step[] = ["id", "instagram", "whatsapp", "more", "gift"];
const KEY = "sky-share-step";
// Resumes where the customer left off on this link.
function savedStep(token: string | null): Step {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Step>;
    return (token && s[token]) || "id";
  } catch {
    return "id";
  }
}
function saveStep(token: string | null, step: Step) {
  if (!token) return;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Step>;
    localStorage.setItem(KEY, JSON.stringify({ ...s, [token]: step }));
  } catch {
    // Storage blocked: progress lasts for this page only.
  }
}
/** Opens once the poster is ready: Instagram (checked by its post link), then
 *  WhatsApp (confirmed), then optional Facebook and others, then the gift. */
export function ShareWizard({
  poster,
  caption,
  filename,
  onClose,
}: {
  poster: Blob;
  caption: string;
  filename: string;
  onClose: () => void;
}) {
  const token = useStudio((s) => s.token);
  const reward = getReward(useStudio((s) => s.reward));
  const [step, setStepState] = useState<Step>(() => savedStep(token));
  const [opened, setOpened] = useState(false);
  const [link, setLink] = useState("");
  const [handle, setHandle] = useState(useStudio.getState().instagramId);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const go = (next: Step) => {
    saveStep(token, next);
    setStepState(next);
    setOpened(false);
    setError("");
  };
  // Sharing only starts once the customer's Instagram ID is saved.
  async function submitId(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const { handle: saved } = await saveProfile(token, "instagram", handle.trim());
      useStudio.getState().setInstagramId(saved);
      go("instagram");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function shareInstagram() {
    if (token) trackShare(token, "share_opened_instagram");
    const result = await sharePoster("instagram", poster, filename, caption);
    if (result === "cancelled") return setError("Sharing was cancelled. Tap the button to try again.");
    if (token) trackShare(token, "shared_instagram");
    setOpened(true);
  }
  async function submitInstagram(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await savePostLink(token, "instagram", link.trim());
      go("whatsapp");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function shareWhatsapp() {
    if (await shareOnWhatsapp(poster, caption, filename)) setOpened(true);
  }
  async function confirmWhatsapp() {
    if (!token || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      await savePostLink(token, "whatsapp");
      go("more");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await unlockGift(token);
      go("gift");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // The step tracker starts at Instagram; the ID comes before it.
  const index = Math.max(0, STEPS.indexOf(step) - 1);
  return (
    <div className="notice-shade" role="presentation">
      <motion.div
        key={step}
        className="notice-window share-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        initial={{ opacity: 0, scale: 0.9, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
      >
        {step === "id" && (
          <form onSubmit={(e) => void submitId(e)}>
            <span className="notice-icon ig-icon" aria-hidden="true"><Instagram size={28} /></span>
            <h2 id="wizard-title">Your Instagram ID</h2>
            <p>Enter the Instagram account you will share your poster from.</p>
            <label htmlFor="wizard-handle">Instagram ID</label>
            <input
              id="wizard-handle"
              className="manager-input"
              autoCapitalize="none"
              autoComplete="off"
              maxLength={60}
              placeholder="e.g. @yourname"
              value={handle}
              onChange={(e) => setHandle(e.target.value.replace(/\s/g, ""))}
              autoFocus
            />
            <button className="spin-button phone-continue" disabled={busy || !handle.trim()}>
              {busy ? "Saving…" : "Continue to sharing"}
            </button>
          </form>
        )}
        {step !== "gift" && (
          <button type="button" className="share-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        )}
        {step !== "gift" && step !== "id" && (
          <ol className="wizard-steps" aria-label="Steps">
            {["Instagram", "WhatsApp", "More"].map((label, i) => (
              <li key={label} className={i < index ? "done" : i === index ? "now" : ""}>
                {i < index ? <Check size={14} aria-hidden="true" /> : i + 1} {label}
              </li>
            ))}
          </ol>
        )}
        {step === "instagram" && (
          <>
            <span className="notice-icon ig-icon" aria-hidden="true"><Instagram size={28} /></span>
            <h2 id="wizard-title">Step 1: Share on Instagram</h2>
            {!opened ? (
              <>
                <p>Post your poster on Instagram and tag @skymobileandelectronics. The caption is copied for you.</p>
                <button type="button" className="spin-button phone-continue" onClick={() => void shareInstagram()}>
                  <Instagram size={20} aria-hidden="true" /> Share on Instagram
                </button>
              </>
            ) : (
              <form onSubmit={(e) => void submitInstagram(e)}>
                <p>Posted? Open your post, tap ⋯ → Copy link, and paste it here.</p>
                <label htmlFor="wizard-link">Link to your Instagram post</label>
                <input
                  id="wizard-link"
                  className="manager-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://www.instagram.com/p/…"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  autoFocus
                />
                <button className="spin-button phone-continue" disabled={busy || !link.trim()}>
                  {busy ? "Checking…" : "Check my post"}
                </button>
                <button type="button" className="text-button" onClick={() => void shareInstagram()}>
                  Share again
                </button>
              </form>
            )}
          </>
        )}
        {step === "whatsapp" && (
          <>
            <span className="notice-icon wa-icon" aria-hidden="true"><MessageCircle size={28} /></span>
            <h2 id="wizard-title">Step 2: Share on WhatsApp</h2>
            <p>Put your poster on your WhatsApp Status and send it to at least 3 groups.</p>
            <button type="button" className="whatsapp-cta" onClick={() => void shareWhatsapp()}>
              <MessageCircle size={22} aria-hidden="true" /> Share on WhatsApp
            </button>
            {opened && (
              <>
                <label className="terms-check">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  I have posted it on my WhatsApp Status
                </label>
                <button
                  type="button"
                  className="spin-button phone-continue"
                  disabled={busy || !confirmed}
                  onClick={() => void confirmWhatsapp()}
                >
                  {busy ? "Saving…" : "Continue"}
                </button>
              </>
            )}
          </>
        )}
        {step === "more" && (
          <>
            <span className="notice-icon" aria-hidden="true"><Share2 size={26} /></span>
            <h2 id="wizard-title">Step 3: Share with more friends</h2>
            <p>Optional: share on Facebook and other apps too.</p>
            <div className="share-buttons">
              <button
                type="button"
                onClick={() => {
                  if (token) trackShare(token, "share_opened_facebook");
                  void sharePoster("facebook", poster, filename, caption).then(
                    (r) => r !== "cancelled" && token && trackShare(token, "shared_facebook"),
                  );
                }}
              >
                <Facebook size={20} aria-hidden="true" /> Facebook
              </button>
              <button
                type="button"
                onClick={() => {
                  if (token) trackShare(token, "share_opened_more");
                  void copyCaption(caption);
                  void sharePoster("more", poster, filename, caption).then(
                    (r) => r !== "cancelled" && token && trackShare(token, "shared_more"),
                  );
                }}
              >
                <Share2 size={20} aria-hidden="true" /> Others
              </button>
            </div>
            <button type="button" className="spin-button phone-continue" disabled={busy} onClick={() => void finish()}>
              {busy ? "Saving…" : "Done"}
            </button>
          </>
        )}
        {step === "gift" && (
          <>
            <span className="notice-icon gift-icon" aria-hidden="true"><Gift size={30} /></span>
            <h2 id="wizard-title">Get your gift from the store!</h2>
            {reward && <p className="gift-name">🎁 {reward.label}</p>}
            <p>Show this screen to the SKY staff to collect your gift. Thank you for celebrating Diwali with us!</p>
            <button type="button" className="spin-button phone-continue" onClick={onClose}>
              OK
            </button>
          </>
        )}
        <p className="phone-help phone-help-error" role="alert">{error}</p>
      </motion.div>
    </div>
  );
}
