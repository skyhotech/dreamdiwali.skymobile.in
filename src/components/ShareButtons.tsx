import { useState } from "react";
import { Facebook, Instagram, MessageCircle, Share2 } from "lucide-react";
import { trackShare } from "../lib/backend";
import { sharePoster, type ShareTarget } from "../lib/sharing";
import { useStudio } from "../lib/store";
const BUTTONS = [
  ["instagram", "Instagram", Instagram],
  ["facebook", "Facebook", Facebook],
  ["whatsapp", "WhatsApp", MessageCircle],
  ["more", "More", Share2],
] as const;
export function ShareButtons({
  poster,
  caption,
  filename,
}: {
  poster: Blob;
  caption: string;
  filename: string;
}) {
  const [note, setNote] = useState("");
  async function share(target: ShareTarget, label: string) {
    const result = await sharePoster(target, poster, filename, caption);
    const { token } = useStudio.getState();
    if (token && result !== "cancelled") trackShare(token, target);
    setNote(
      result === "fallback"
        ? `Poster downloaded and caption copied. Add them in ${label}.`
        : result === "cancelled"
          ? "Sharing cancelled. Your poster and caption are still ready."
          : "Caption copied. Paste it if the app leaves it out.",
    );
  }
  return (
    <>
      <div className="share-buttons">
        {BUTTONS.map(([target, label, Icon]) => (
          <button key={target} onClick={() => void share(target, label)}>
            <Icon size={20} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <p role="status">{note}</p>
    </>
  );
}
