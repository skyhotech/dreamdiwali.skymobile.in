import { MessageCircle } from "lucide-react";
import { getPosterUrl, trackShare } from "../lib/backend";
import { copyCaption } from "../lib/sharing";
import { useStudio } from "../lib/store";
/** Sends the poster image itself, so it can go on WhatsApp Status and into
 *  groups; phones that can't share images get a WhatsApp link instead. */
export async function shareOnWhatsapp(
  poster: Blob,
  caption: string,
  filename: string,
  posterLink = "",
) {
  const { token } = useStudio.getState();
  if (token) trackShare(token, "share_opened_whatsapp");
  void copyCaption(caption);
  const file = new File([poster], filename, { type: poster.type });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], text: caption });
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
    }
  } else {
    const url = posterLink || getPosterUrl();
    const text = url ? `${caption}\n\n${url}` : caption;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }
  if (token) trackShare(token, "shared_whatsapp");
  return true;
}
/** The big green button beside "Post on Instagram". */
export function WhatsAppButton({
  onShare,
  label = "Share on WhatsApp",
}: {
  onShare: () => void;
  label?: string;
}) {
  return (
    <button type="button" className="whatsapp-cta" onClick={onShare}>
      <MessageCircle size={22} aria-hidden="true" />
      {label}
    </button>
  );
}
/** After sharing elsewhere: the terms also ask for WhatsApp Status. */
export function WhatsAppNudge({
  onShare,
  onClose,
}: {
  onShare: () => void;
  onClose: () => void;
}) {
  return (
    <div className="notice-shade" role="presentation">
      <div className="notice-window" role="dialog" aria-modal="true" aria-labelledby="wa-nudge-title">
        <span className="notice-icon wa-icon" aria-hidden="true">
          <MessageCircle size={28} />
        </span>
        <h2 id="wa-nudge-title">One more step for your iPhone 15 chance!</h2>
        <p>Share your poster on your WhatsApp Status and in at least 3 groups.</p>
        <WhatsAppButton
          label="Share on WhatsApp now"
          onShare={() => {
            onClose();
            onShare();
          }}
        />
        <button type="button" className="text-button" onClick={onClose}>
          Later
        </button>
      </div>
    </div>
  );
}
