import { useEffect, useState } from "react";
import { Check, Facebook, Gift, Instagram, MessageCircle, Share2, X } from "lucide-react";
import { motion } from "motion/react";
import { rewardProgress, savePostLink, saveProfile, trackShare, unlockGift, uploadProof, type RewardProgress } from "../lib/backend";
import { getReward } from "../lib/rewards";
import { copyCaption, sharePoster } from "../lib/sharing";
import { useStudio } from "../lib/store";
import { shareOnWhatsapp } from "./WhatsAppShare";
type Step = "id" | "instagram" | "follow" | "whatsapp" | "more" | "review" | "waiting" | "gift";
const STEPS: Step[] = ["id", "instagram", "follow", "whatsapp", "more", "review", "waiting", "gift"];
const SKY_INSTAGRAM = "https://www.instagram.com/skymobileandelectronics/";
const GOOGLE_REVIEW = "https://share.google/NKGfoZcazwt9js7kL";
// How often the waiting screen asks whether staff verified the screenshot.
const CHECK_MS = 15_000;
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
/** One required check on the waiting screen. */
function Check1({ label, state, retry }: { label: string; state: string; retry?: () => void }) {
  const text = { verified: "✓ verified", pending: "⏳ being checked", rejected: "✕ not accepted" }[state] ?? "✕ missing";
  return (
    <li className={state === "verified" ? "done" : state === "rejected" || !state ? "bad" : ""}>
      {label}: {text}
      {retry && (state === "rejected" || !state) && (
        <button type="button" className="text-button" onClick={retry}>
          Upload again
        </button>
      )}
    </li>
  );
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
      go("follow");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function shareWhatsapp() {
    if (await shareOnWhatsapp(poster, caption, filename)) setOpened(true);
  }
  async function sendProof(kind: "whatsapp" | "follow", file: File | undefined) {
    if (!token || !file) return;
    setBusy(true);
    setError("");
    try {
      await uploadProof(token, kind, file);
      go(kind === "follow" ? "whatsapp" : "more");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // The gift is granted only after staff verify the WhatsApp screenshot.
  async function finish() {
    go("review");
  }
  const [progress, setProgress] = useState<RewardProgress | null>(null);
  useEffect(() => {
    if (step !== "waiting" || !token) return;
    let live = true;
    const check = async () => {
      try {
        const p = await rewardProgress(token);
        if (!live) return;
        setProgress(p);
        if (p.ready) {
          await unlockGift(token);
          if (live) go("gift");
        }
      } catch {
        // A lost check on a bad network: the next one tries again.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [step, token]);
  // The step tracker starts at Instagram; the ID comes before it.
  const index = Math.min(5, Math.max(0, STEPS.indexOf(step) - 1));
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
            {["Post", "Follow", "WhatsApp", "More", "Review", "Verify"].map((label, i) => (
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
        {step === "follow" && (
          <>
            <span className="notice-icon ig-icon" aria-hidden="true"><Instagram size={28} /></span>
            <h2 id="wizard-title">Step 2: Follow us on Instagram</h2>
            <p>Follow @skymobileandelectronics, then take a screenshot of our profile showing "Following" and upload it.</p>
            <a
              className="spin-button phone-continue"
              href={SKY_INSTAGRAM}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (token) trackShare(token, "follow_opened");
                setOpened(true);
              }}
            >
              <Instagram size={20} aria-hidden="true" /> Open our Instagram
            </a>
            {opened && (
              <label className="spin-button phone-continue wizard-upload">
                {busy ? "Uploading…" : "Upload \"Following\" screenshot"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={busy}
                  aria-label="Instagram following screenshot"
                  onChange={(e) => {
                    void sendProof("follow", e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </>
        )}
        {step === "review" && (
          <>
            <span className="notice-icon gift-icon" aria-hidden="true"><Gift size={28} /></span>
            <h2 id="wizard-title">Tell others about SKY</h2>
            <p>Happy with your visit? We'd love a Google review. It's optional and doesn't affect your gift.</p>
            <a
              className="spin-button phone-continue"
              href={GOOGLE_REVIEW}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => token && trackShare(token, "google_review_opened")}
            >
              Leave a Google review
            </a>
            <button type="button" className="text-button" onClick={() => go("waiting")}>
              Continue
            </button>
          </>
        )}
        {step === "whatsapp" && (
          <>
            <span className="notice-icon wa-icon" aria-hidden="true"><MessageCircle size={28} /></span>
            <h2 id="wizard-title">Step 3: Share on WhatsApp</h2>
            <p>Put your poster on your WhatsApp Status and send it to at least 3 groups.</p>
            <button type="button" className="whatsapp-cta" onClick={() => void shareWhatsapp()}>
              <MessageCircle size={22} aria-hidden="true" /> Share on WhatsApp
            </button>
            {opened && (
              <>
                <p>Posted? Open your WhatsApp Status, take a screenshot, and upload it here as proof.</p>
                <label className="spin-button phone-continue wizard-upload">
                  {busy ? "Uploading…" : "Upload Status screenshot"}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={busy}
                    aria-label="WhatsApp Status screenshot"
                    onChange={(e) => {
                      void sendProof("whatsapp", e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </>
            )}
          </>
        )}
        {step === "more" && (
          <>
            <span className="notice-icon" aria-hidden="true"><Share2 size={26} /></span>
            <h2 id="wizard-title">Step 4: Share with more friends</h2>
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
        {step === "waiting" && (
          <>
            <span className="notice-icon wa-icon" aria-hidden="true"><MessageCircle size={28} /></span>
            <h2 id="wizard-title">Waiting for SKY to verify</h2>
            <p>Our staff are checking your shares. Your gift unlocks here once everything is verified. Keep this page open, or show it at the counter.</p>
            <ul className="wizard-progress">
              <Check1 label="Instagram post link" state={progress?.instagram_post ? "verified" : ""} />
              <Check1 label="Following on Instagram" state={progress?.instagram_follow ?? ""} retry={() => go("follow")} />
              <Check1 label="WhatsApp Status" state={progress?.whatsapp_status ?? ""} retry={() => go("whatsapp")} />
              <li className="done">Google review {progress?.google_review_opened ? "opened (thank you!)" : "(optional)"}</li>
            </ul>
            {!progress?.ready && <div className="wizard-wait" aria-hidden="true" />}
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
