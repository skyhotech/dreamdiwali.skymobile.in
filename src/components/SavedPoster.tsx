import { useEffect, useState } from "react";
import { instagramCaption } from "../lib/sharing";
import { ShareButtons } from "./ShareButtons";
// A customer who reopens their link after finishing gets their poster back.
export function SavedPoster({ url }: { url: string }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(url)
      .then((r) => r.blob())
      .then((b) => live && setBlob(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <div className="phone-card manager-card">
      <h1 className="phone-title">Your Diwali poster</h1>
      <img className="saved-poster" src={url} alt="Your SKY Diwali poster" />
      {blob ? (
        <ShareButtons
          poster={blob}
          caption={instagramCaption(1)}
          filename="SKY-Diwali.jpg"
        />
      ) : (
        <p className="phone-help">Preparing sharing…</p>
      )}
    </div>
  );
}
