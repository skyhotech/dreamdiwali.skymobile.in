import { useState } from "react";
import { Facebook, Instagram, MessageCircle, Share2, X } from "lucide-react";
import { getPosterUrl, savePostLink, saveProfile, trackShare } from "../lib/backend";
import { copyCaption, sharePoster } from "../lib/sharing";
import { useStudio } from "../lib/store";
type Platform = "instagram" | "facebook" | "whatsapp" | "more";
const BUTTONS = [
  ["instagram", "Instagram", Instagram],
  ["facebook", "Facebook", Facebook],
  ["whatsapp", "WhatsApp", MessageCircle],
  ["more", "More", Share2],
] as const;
const ASK = {
  instagram: { label: "Your Instagram ID", placeholder: "e.g. @yourname" },
  facebook: { label: "Your Facebook profile link", placeholder: "e.g. facebook.com/yourname" },
};
const POST_HINT: Record<string, string> = {
  instagram: "https://www.instagram.com/p/…",
  facebook: "https://www.facebook.com/…",
};
// Instagram, Facebook and WhatsApp are opened by SKY so each step can be
// counted: the profile used, the app opened, and the link of the post as
// proof. "More" is the phone's own share sheet. No website can see inside
// these apps, so posting is confirmed by the customer's post link.
export function ShareButtons({
  poster,
  caption,
  filename,
  posterLink = "",
}: {
  poster: Blob;
  caption: string;
  filename: string;
  /** The poster's public address, when already known. */
  posterLink?: string;
}) {
  const [note, setNote] = useState("");
  const [ask, setAsk] = useState<"instagram" | "facebook" | null>(null);
  const [handle, setHandle] = useState("");
  const [proof, setProof] = useState<Platform | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = useStudio((s) => s.token);
  const track = (kind: string) => token && trackShare(token, kind);

  async function open(platform: Platform) {
    track(`share_opened_${platform}`);
    const url = posterLink || getPosterUrl();
    if (platform === "whatsapp") {
      void copyCaption(caption);
      const text = url ? `${caption}\n\n${url}` : caption;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      track("shared_whatsapp");
      setNote("WhatsApp opened with your poster and caption.");
      return;
    }
    if (platform === "facebook" && url) {
      void copyCaption(caption);
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        "_blank",
        "noopener",
      );
      track("shared_facebook");
      setNote("Facebook opened. Paste the copied caption, then post.");
      setProof("facebook");
      return;
    }
    // Instagram (and Facebook before the poster is online): the share sheet
    // is the only way a website can hand an image to the app.
    const result = await sharePoster(platform, poster, filename, caption);
    if (result === "cancelled") {
      setNote("Sharing cancelled. Your poster and caption are still ready.");
      return;
    }
    track(`shared_${platform}`);
    setNote(
      platform === "more"
        ? "Shared. Thank you!"
        : `Choose ${platform === "instagram" ? "Instagram" : "Facebook"}, paste the copied caption and post.`,
    );
    if (platform !== "more") setProof(platform);
  }
  async function start(platform: Platform) {
    setError("");
    if (platform === "instagram" || platform === "facebook") {
      setHandle("");
      setAsk(platform);
      return;
    }
    await open(platform);
  }
  async function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!ask || !token) return;
    setBusy(true);
    setError("");
    try {
      await saveProfile(token, ask, handle.trim());
      const platform = ask;
      setAsk(null);
      await open(platform);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submitProof(e: React.FormEvent) {
    e.preventDefault();
    if (!proof || !token) return;
    setBusy(true);
    setError("");
    try {
      await savePostLink(token, proof, link.trim());
      setProof(null);
      setLink("");
      setNote("Thank you! Your post is recorded for the iPhone 15 contest.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="share-buttons">
        {BUTTONS.map(([target, label, Icon]) => (
          <button key={target} onClick={() => void start(target)}>
            <Icon size={20} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <p role="status">{note}</p>
      {(ask || proof) && (
        <div className="notice-shade" role="presentation">
          <form
            className="notice-window share-window"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            onSubmit={(e) => void (ask ? submitProfile(e) : submitProof(e))}
          >
            <button
              type="button"
              className="share-close"
              aria-label="Close"
              onClick={() => {
                setAsk(null);
                setProof(null);
              }}
            >
              <X size={18} />
            </button>
            {ask ? (
              <>
                <h2 id="share-title">Share on {ask === "instagram" ? "Instagram" : "Facebook"}</h2>
                <label htmlFor="share-handle">{ASK[ask].label}</label>
                <input
                  id="share-handle"
                  className="manager-input"
                  autoCapitalize="none"
                  autoComplete="off"
                  placeholder={ASK[ask].placeholder}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  autoFocus
                />
              </>
            ) : (
              <>
                <h2 id="share-title">Did you post it?</h2>
                <p>
                  Paste the link to your post so SKY can count it for the iPhone 15
                  contest.
                </p>
                <label htmlFor="share-link">Link to your post</label>
                <input
                  id="share-link"
                  className="manager-input"
                  type="url"
                  inputMode="url"
                  placeholder={POST_HINT[proof!] ?? "https://…"}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  autoFocus
                />
              </>
            )}
            <p className="phone-help phone-help-error" role="alert">
              {error}
            </p>
            <button className="spin-button phone-continue" disabled={busy}>
              {busy ? "Saving…" : ask ? "Continue" : "Submit post link"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
