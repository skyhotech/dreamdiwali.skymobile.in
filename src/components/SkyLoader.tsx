import { useEffect, useState } from "react";
import skyLogo from "../assets/brand/sky.webp";
import { subscribeLoading } from "../lib/loading";
// Only shown when a request takes a moment: quick ones don't flash it.
const SHOW_AFTER_MS = 250;
// A request lost on a bad network must not leave the logo spinning forever.
const GIVE_UP_MS = 15_000;
/** The SKY logo spinning in the centre of the screen while the server works. */
export function SkyLoader() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer = 0,
      giveUp = 0;
    return subscribeLoading((busy) => {
      window.clearTimeout(timer);
      window.clearTimeout(giveUp);
      if (busy) {
        timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
        giveUp = window.setTimeout(() => setVisible(false), GIVE_UP_MS);
      } else setVisible(false);
    });
  }, []);
  if (!visible) return null;
  return (
    <div className="sky-loader" role="status" aria-live="polite">
      <img src={skyLogo} alt="" />
      <span>Please wait…</span>
    </div>
  );
}
