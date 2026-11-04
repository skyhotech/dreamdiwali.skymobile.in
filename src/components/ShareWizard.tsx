import { useEffect, useRef, useState } from "react";
import { Check, Gift, ImagePlus, Instagram, MessageCircle, Share2 } from "lucide-react";
import { motion } from "motion/react";
import { getPosterUrl, rewardProgress, savePostLink, saveProfile, trackShare, unlockGift, uploadProof, type ProofKind, type RewardProgress } from "../lib/backend";
import { download } from "../lib/images";
import { getReward } from "../lib/rewards";
import { copyCaption, sharePoster } from "../lib/sharing";
import { useStudio } from "../lib/store";
type Step = "id" | "share" | "follow" | "review" | "waiting" | "gift";
const STEPS: Step[] = ["id", "share", "follow", "review", "waiting", "gift"];
type Platform = "instagram" | "whatsapp" | "more";
const SKY_INSTAGRAM = "https://www.instagram.com/skymobileandelectronics/";
const GOOGLE_REVIEW = "https://share.google/NKGfoZcazwt9js7kL";
// A real Instagram post, reel or story address (the server checks it too).
const INSTAGRAM_POST =
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|stories\/[A-Za-z0-9._]+|[A-Za-z0-9._]+\/(?:p|reel))\/[A-Za-z0-9_-]+/i;
// Any public web address, for shares on other apps.
const WEB_LINK = /^https?:\/\/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/;
const MAX_SHOT_BYTES = 12 * 1024 * 1024;
// How often the waiting screen asks whether staff verified the screenshots.
const CHECK_MS = 15_000;
const KEY = "sky-share-step";
const PROOF_KEY = "sky-share-proof";
type Saved = { opened: Platform[]; proved: Platform[] };
function load<T>(key: string, token: string | null, fallback: T): T {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, T>;
    return (token && all[token]) || fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, token: string | null, value: unknown) {
  if (!token) return;
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...all, [token]: value }));
  } catch {
    // Storage blocked: progress lasts for this page only.
  }
}
// Resumes where the customer left off on this link (older links saved one
// step per platform; those are all on the share page now).
function savedStep(token: string | null): Step {
  const step = load<string>(KEY, token, "id");
  return STEPS.includes(step as Step) ? (step as Step) : "share";
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
/** Proof for one platform, shown once the customer has shared there: the
 *  post's link (checked by `pattern`) or a screenshot. */
function ProofBox({
  platform,
  pattern,
  linkLabel,
  placeholder,
  onDone,
}: {
  platform: Platform;
  pattern?: RegExp;
  linkLabel?: string;
  placeholder?: string;
  onDone: (how: "link" | "screenshot") => void;
}) {
  const token = useStudio((s) => s.token);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `proof-${platform}`;
  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    const url = link.trim();
    if (!pattern || !token) return;
    if (!pattern.test(url))
      return setError(
        platform === "instagram"
          ? "Paste the link to your Instagram post, reel or story (https://www.instagram.com/p/…)."
          : "Paste a full link that starts with https://",
      );
    setBusy(true);
    setError("");
    try {
      await savePostLink(token, platform, url);
      onDone("link");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendShot(file: File | undefined) {
    if (!file || !token) return;
    if (!file.type.startsWith("image/")) return setError("Choose a screenshot image (JPG or PNG).");
    if (file.size > MAX_SHOT_BYTES) return setError("That image is too large (max 12 MB).");
    setBusy(true);
    setError("");
    try {
      await uploadProof(token, platform as ProofKind, file);
      onDone("screenshot");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="proof-box" noValidate onSubmit={(e) => void sendLink(e)}>
      {pattern && (
        <>
          <label htmlFor={id}>{linkLabel}</label>
          <div className="proof-link">
            <input
              id={id}
              className="manager-input"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              placeholder={placeholder}
              value={link}
              aria-invalid={Boolean(link.trim()) && !pattern.test(link.trim())}
              onChange={(e) => setLink(e.target.value)}
            />
            <button className="spin-button" disabled={busy || !link.trim()}>
              {busy ? "Checking…" : "Send link"}
            </button>
          </div>
          <span className="proof-or">or</span>
        </>
      )}
      <label className="proof-shot">
        <ImagePlus size={18} aria-hidden="true" />
        {busy ? "Uploading…" : "Upload a screenshot"}
        <input
          type="file"
          accept="image/*"
          hidden
          disabled={busy}
          aria-label={`${platform === "instagram" ? "Instagram post" : platform === "whatsapp" ? "WhatsApp Status" : "Other app share"} screenshot`}
          onChange={(e) => {
            void sendShot(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <p className="phone-help phone-help-error" role="alert">{error}</p>
    </form>
  );
}
/** Opens once the poster is ready, as its own page: the Instagram ID, then
 *  Instagram, WhatsApp and other apps side by side (each asking for proof once
 *  the customer comes back), following our Instagram, an optional Google
 *  review, staff verification, and the gift. */
export function ShareWizard({
  poster,
  caption,
  filename,
  onClose,
}: {
  poster: Blob;
  caption: string;
  filename: string;
  onClose?: () => void;
}) {
  const token = useStudio((s) => s.token);
  const reward = getReward(useStudio((s) => s.reward));
  const [step, setStepState] = useState<Step>(() => savedStep(token));
  const [saved, setSaved] = useState<Saved>(() => load(PROOF_KEY, token, { opened: [], proved: [] }));
  const [opened, setOpened] = useState(false);
  const [handle, setHandle] = useState(useStudio.getState().instagramId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const away = useRef<Platform | null>(null);
  const go = (next: Step) => {
    store(KEY, token, next);
    setStepState(next);
    setOpened(false);
    setError("");
  };
  const update = (change: (s: Saved) => Saved) =>
    setSaved((s) => {
      const next = change(s);
      store(PROOF_KEY, token, next);
      return next;
    });
  const markOpened = (p: Platform) => {
    away.current = p;
    update((s) => (s.opened.includes(p) ? s : { ...s, opened: [...s.opened, p] }));
  };
  const proved = (p: Platform) => update((s) => ({ ...s, proved: [...s.proved.filter((x) => x !== p), p] }));
  // Back from Instagram/WhatsApp/another app: recorded, and that app's proof
  // field is brought into view.
  useEffect(() => {
    const back = () => {
      const p = away.current;
      if (document.hidden || !p) return;
      away.current = null;
      if (token) trackShare(token, `returned_${p}`);
      window.setTimeout(() => document.getElementById(`share-${p}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [token]);
  // Sharing only starts once the customer's Instagram ID is saved.
  async function submitId(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const { handle: savedHandle } = await saveProfile(token, "instagram", handle.trim());
      useStudio.getState().setInstagramId(savedHandle);
      go("share");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const ext = poster.type === "image/png" ? "png" : "jpg";
  const name = filename.replace(/\.\w+$/, `.${ext}`);
  // Straight into Instagram: the poster is saved to the phone and the caption
  // copied, ready for a new post.
  function openInstagram() {
    if (token) trackShare(token, "share_opened_instagram");
    void copyCaption(caption);
    download(poster, name);
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
    if (token) trackShare(token, "shared_instagram");
    markOpened("instagram");
  }
  // Straight into WhatsApp with the caption and the poster's link filled in;
  // the poster is also saved to the phone for the Status.
  function openWhatsapp() {
    if (token) trackShare(token, "share_opened_whatsapp");
    void copyCaption(caption);
    download(poster, name);
    const url = getPosterUrl();
    const text = url ? `${caption}\n\n${url}` : caption;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    if (token) trackShare(token, "shared_whatsapp");
    markOpened("whatsapp");
  }
  async function openOthers() {
    if (token) trackShare(token, "share_opened_more");
    markOpened("more");
    const result = await sharePoster("more", poster, name, caption);
    if (result !== "cancelled" && token) trackShare(token, "shared_more");
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
    // go only changes state; re-running on its identity would restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, token]);
  const index = STEPS.indexOf(step) - 1;
  const has = (list: Platform[], p: Platform) => list.includes(p);
  const card = (
    p: Platform,
    title: string,
    button: React.ReactNode,
    hint: string,
    proof: React.ReactNode,
  ) => (
    <li id={`share-${p}`} className={`share-card share-card-${p}${has(saved.proved, p) ? " done" : ""}`}>
      <h3>{title}</h3>
      {button}
      {has(saved.proved, p) ? (
        <p className="proof-done">
          <Check size={16} aria-hidden="true" /> Proof sent. Thank you!
        </p>
      ) : (
        has(saved.opened, p) && (
          <>
            <p>{hint}</p>
            {proof}
          </>
        )
      )}
    </li>
  );
  return (
    <section className="share-page" aria-labelledby="wizard-title">
      <motion.div key={step} className="share-page-body" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        {step !== "gift" && step !== "id" && (
          <ol className="wizard-steps" aria-label="Steps">
            {["Share", "Follow", "Review", "Verify"].map((label, i) => (
              <li key={label} className={i < index ? "done" : i === index ? "now" : ""}>
                {i < index ? <Check size={14} aria-hidden="true" /> : i + 1} {label}
              </li>
            ))}
          </ol>
        )}
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
        {step === "share" && (
          <>
            <h2 id="wizard-title">Step 1: Share your poster</h2>
            <p>Share on Instagram and WhatsApp. When you come back here, send the link or a screenshot as proof.</p>
            <ol className="share-cards">
              {card(
                "instagram",
                "1. Instagram",
                <button type="button" className="share-round share-round-ig" onClick={openInstagram}>
                  <Instagram size={22} aria-hidden="true" /> Share on Instagram
                </button>,
                "Posted? Tag @skymobileandelectronics, then open your post → ⋯ → Copy link and paste it here.",
                <ProofBox
                  platform="instagram"
                  pattern={INSTAGRAM_POST}
                  linkLabel="Link to your Instagram post"
                  placeholder="https://www.instagram.com/p/…"
                  onDone={() => proved("instagram")}
                />,
              )}
              {card(
                "whatsapp",
                "2. WhatsApp",
                <button type="button" className="share-round share-round-wa" onClick={openWhatsapp}>
                  <MessageCircle size={22} aria-hidden="true" /> Share on WhatsApp
                </button>,
                "Put the poster (saved to your gallery) on your WhatsApp Status, then upload a screenshot of it.",
                <ProofBox platform="whatsapp" onDone={() => proved("whatsapp")} />,
              )}
              {card(
                "more",
                "3. Others (optional)",
                <button type="button" className="share-round share-round-more" onClick={() => void openOthers()}>
                  <Share2 size={22} aria-hidden="true" /> Share on other apps
                </button>,
                "Shared somewhere else? Paste the link or upload a screenshot.",
                <ProofBox
                  platform="more"
                  pattern={WEB_LINK}
                  linkLabel="Link to your post"
                  placeholder="https://…"
                  onDone={() => proved("more")}
                />,
              )}
            </ol>
            <button
              type="button"
              className="spin-button phone-continue"
              disabled={!has(saved.proved, "instagram") || !has(saved.proved, "whatsapp")}
              onClick={() => go("follow")}
            >
              Continue
            </button>
            {(!has(saved.proved, "instagram") || !has(saved.proved, "whatsapp")) && (
              <p className="phone-help">Send proof for Instagram and WhatsApp to continue.</p>
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
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file || !token) return;
                    if (!file.type.startsWith("image/")) return setError("Choose a screenshot image (JPG or PNG).");
                    setBusy(true);
                    setError("");
                    uploadProof(token, "follow", file)
                      .then(() => go("review"))
                      .catch((err: Error) => setError(err.message))
                      .finally(() => setBusy(false));
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
        {step === "waiting" && (
          <>
            <span className="notice-icon wa-icon" aria-hidden="true"><MessageCircle size={28} /></span>
            <h2 id="wizard-title">Waiting for SKY to verify</h2>
            <p>Our staff are checking your shares. Your gift unlocks here once everything is verified. Keep this page open, or show it at the counter.</p>
            <ul className="wizard-progress">
              <Check1
                label="Instagram post"
                state={progress?.instagram_post ? "verified" : (progress?.instagram_proof ?? "")}
                retry={() => {
                  update((s) => ({ ...s, proved: s.proved.filter((x) => x !== "instagram") }));
                  go("share");
                }}
              />
              <Check1 label="Following on Instagram" state={progress?.instagram_follow ?? ""} retry={() => go("follow")} />
              <Check1
                label="WhatsApp Status"
                state={progress?.whatsapp_status ?? ""}
                retry={() => {
                  update((s) => ({ ...s, proved: s.proved.filter((x) => x !== "whatsapp") }));
                  go("share");
                }}
              />
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
            {onClose && (
              <button type="button" className="spin-button phone-continue" onClick={onClose}>
                OK
              </button>
            )}
          </>
        )}
        <p className="phone-help phone-help-error" role="alert">{error}</p>
      </motion.div>
    </section>
  );
}
