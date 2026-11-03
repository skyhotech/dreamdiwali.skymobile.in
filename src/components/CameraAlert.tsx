import { useEffect, useState } from "react";
import { Camera, Copy } from "lucide-react";
import { cameraHelp, type CameraHelp } from "../lib/cameraHelp";
// Shown over the camera whenever it can't start: what is wrong and the steps
// for this phone, from the phone's own settings to opening a proper browser.
export function CameraAlert({
  failure,
  retry,
}: {
  failure: string;
  retry: () => void;
}) {
  const [help, setHelp] = useState<CameraHelp | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void cameraHelp(failure).then((h) => live && setHelp(h));
    return () => {
      live = false;
    };
  }, [failure]);
  if (!help) return null;
  return (
    <div className="camera-denied" role="alertdialog" aria-labelledby="camera-help-title">
      <Camera size={30} aria-hidden="true" />
      <b id="camera-help-title">{help.title}</b>
      <ol className="camera-help-steps">
        {help.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {help.problem === "in-app" ? (
        <button
          className="spin-button"
          onClick={() =>
            void navigator.clipboard?.writeText(location.href).then(() => setCopied(true))
          }
        >
          <Copy size={18} aria-hidden="true" /> {copied ? "Link copied" : "Copy link"}
        </button>
      ) : (
        <button className="spin-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
