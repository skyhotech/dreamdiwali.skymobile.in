// Why a camera won't start, in the customer's words, with the exact steps for
// their phone. Browsers report the same error for "you refused" and "the
// phone's own camera switch is off", so the browser's permission state and the
// device decide which steps to show.
export type CameraProblem =
  | "in-app"
  | "site-blocked"
  | "device-blocked"
  | "overlay"
  | "busy"
  | "missing"
  | "insecure"
  | "unknown";
export type CameraHelp = { problem: CameraProblem; title: string; steps: string[] };

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
export const isIos = /iPhone|iPad|iPod/i.test(ua);
export const isAndroid = /Android/i.test(ua);
// Instagram, Facebook, Messenger, Snapchat and similar apps open links in their
// own built-in browser, which often has no camera access at all.
export const inAppBrowser =
  /Instagram|FBAN|FBAV|FB_IAB|Messenger|Snapchat|Line\//i.test(ua) ||
  (isAndroid && /; wv\)/.test(ua));
const browserName = /CriOS|Chrome/i.test(ua)
  ? "Chrome"
  : /Firefox|FxiOS/i.test(ua)
    ? "Firefox"
    : /SamsungBrowser/i.test(ua)
      ? "Samsung Internet"
      : isIos
        ? "Safari"
        : "your browser";

export async function cameraHelp(errorName: string): Promise<CameraHelp> {
  if (inAppBrowser)
    return {
      problem: "in-app",
      title: "Open this page in your browser",
      steps: [
        "This app's built-in browser can't use the camera.",
        "Tap Copy link below.",
        `Open ${isIos ? "Safari" : "Chrome"}, paste the link and open it.`,
      ],
    };
  if (errorName === "SecurityError" || !navigator.mediaDevices?.getUserMedia)
    return {
      problem: "insecure",
      title: "The camera can't start here",
      steps: ["Open the link exactly as it was sent to you (it must start with https://)."],
    };
  if (errorName === "NotFoundError" || errorName === "OverconstrainedError")
    return {
      problem: "missing",
      title: "No camera found",
      steps: ["This device has no usable camera. Please use a phone with a camera."],
    };
  if (errorName === "NotReadableError" || errorName === "AbortError" || errorName === "TrackStartError")
    return {
      problem: "busy",
      title: "The camera is in use or switched off",
      steps: [
        "Close any app using the camera (camera, video call, WhatsApp call).",
        ...(isAndroid
          ? ["Swipe down from the top of the screen and turn ON \"Camera access\" if you see it."]
          : []),
        `Fully close ${browserName}, open it again, then tap Try again.`,
      ],
    };
  // NotAllowedError: refused on this site, or blocked by the phone itself.
  let state = "";
  try {
    state = (await navigator.permissions?.query({ name: "camera" as PermissionName }))?.state ?? "";
  } catch {
    // Some browsers (older Safari) can't report it.
  }
  const deviceBlocked = state === "granted" || isIos;
  if (deviceBlocked)
    return {
      problem: "device-blocked",
      title: "Turn on the camera in your phone settings",
      steps: isIos
        ? [
            "Open the Settings app.",
            `Scroll down and tap ${browserName === "your browser" ? "Safari" : browserName}.`,
            "Tap Camera and choose Allow.",
            "Also check Settings → Screen Time → Content & Privacy Restrictions → Camera is allowed.",
            "Come back here and tap Try again.",
          ]
        : [
            "Open the Settings app.",
            `Tap Apps → ${browserName} → Permissions → Camera → Allow.`,
            "Also open Settings → Security & privacy → Privacy → turn ON \"Camera access\".",
            "Come back here and tap Try again.",
          ],
    };
  // Android Chrome refuses to even ask ("This site can't ask for your
  // permission") while another app draws over the screen.
  if (isAndroid && state !== "denied")
    return {
      problem: "overlay",
      title: "Close apps drawn over the screen",
      steps: [
        "Chrome can't ask for the camera while another app is shown on top of the screen.",
        "Turn off: internet speed meter, chat bubbles / chat heads, screen dimmer or blue-light filter, screen recorder.",
        "Or open Settings → Apps → Special app access → Display over other apps, and switch those apps OFF.",
        "Come back here, tap Try again, then tap Allow.",
      ],
    };
  return {
    problem: "site-blocked",
    title: "Allow the camera for this website",
    steps: [
      "Tap the 🔒 or ⓘ icon next to the web address at the top.",
      "Tap Permissions (or Site settings) → Camera → Allow.",
      "Then tap Try again.",
    ],
  };
}
