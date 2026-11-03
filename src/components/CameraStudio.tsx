import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Instagram,
  RefreshCw,
  CameraOff,
  Copy,
  ExternalLink,
  Download,
  UserPlus,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { useCamera } from "../hooks/useCamera";
import { useExpression } from "../hooks/useExpression";
import { useStudio, MAX_PRODUCTS } from "../lib/store";
import {
  BLANK_PHOTO,
  capture,
  canvasBlob,
  fromBlob,
  download,
  looksBlank,
} from "../lib/images";
import { instagramCaption, copyCaption } from "../lib/sharing";
import {
  instagramReady,
  renderInstagramPost,
  POST_HEIGHT,
  HEADER,
} from "../lib/instagram";
import { frameAsset } from "../lib/frameAssets";
import { getTemplate, templates } from "../templates";
import { Poster } from "./Poster";
import { Templates } from "./Templates";
import { UploadStatus } from "./StatusNotices";
import { ShareButtons } from "./ShareButtons";
import { trackShare } from "../lib/backend";
import { CameraAlert } from "./CameraAlert";
// Hands-free capture: how strong a smile counts, and how long a cue is held.
const SMILE_THRESHOLD = 0.6;
const HOLD_MS = 500;
// A selfie needs a face seen by the camera AI within this long.
const FACE_RECENT_MS = 1500;
const NO_FACE_YET =
  "We can't see your face. Look straight at the camera and try again.";
const AUTO_GESTURES: Record<string, string> = {
  Victory: "✌️ Peace!",
  Thumb_Up: "👍 Thumbs up!",
  Open_Palm: "✋ High five!",
};
export default function CameraStudio() {
  const s = useStudio(),
    product = s.step === "product";
  const [closed, setClosed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [flash, setFlash] = useState(false),
    [completed, setCompleted] = useState(false),
    [poster, setPoster] = useState<Blob | null>(null),
    [captionMessage, setCaptionMessage] = useState("");
  const busyRef = useRef(false);
  const camera = useCamera(
    product ? "environment" : "user",
    !closed && !completed,
  );
  const effect = useExpression(
    camera.videoRef,
    camera.ready && !product && !closed,
  );
  // Hands-free selfie: a smile or ✌️ / 👍 / ✋ held briefly starts a 3-2-1.
  const [autoCapture, setAutoCapture] = useState(true),
    [countdown, setCountdown] = useState<number | null>(null),
    [cueLabel, setCueLabel] = useState("");
  const autoArmed =
    autoCapture &&
    !product &&
    !completed &&
    !closed &&
    !busy &&
    camera.ready &&
    effect.ready;
  useEffect(() => {
    if (!autoArmed || countdown !== null) return;
    let heldSince = 0;
    const id = window.setInterval(() => {
      // Tests can stand in for a real smile or gesture (dev builds only).
      const { smile, gesture } =
        (import.meta.env.DEV &&
          (window as { skyFakeCue?: { smile: number; gesture: string } })
            .skyFakeCue) ||
        effect.cues.current;
      const cue =
        AUTO_GESTURES[gesture] ??
        (smile > SMILE_THRESHOLD ? "😊 Big smile!" : "");
      if (!cue) {
        heldSince = 0;
        return;
      }
      heldSince ||= performance.now();
      if (performance.now() - heldSince >= HOLD_MS) {
        setCueLabel(cue);
        setCountdown(3);
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [autoArmed, countdown, effect.cues]);
  useEffect(() => {
    if (countdown === null) return;
    if (!autoArmed) {
      setCountdown(null);
      return;
    }
    const id = window.setTimeout(() => {
      if (countdown > 1) setCountdown(countdown - 1);
      else {
        setCountdown(null);
        void shoot();
      }
    }, 800);
    return () => window.clearTimeout(id);
    // shoot reads current state; re-running on its identity would reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, autoArmed]);
  const template = getTemplate(s.template),
    caption = instagramCaption(
      s.products.length,
      s.products.map((p) => p.label),
    ),
    filename = `SKY-Diwali-${s.template}`;
  // Only ever called from a tap: phones open the share sheet (and allow the
  // Instagram fallback tab) only straight after one.
  async function post(blob: Blob, text: string) {
    const name = `${filename}.${blob.type === "image/png" ? "png" : "jpg"}`;
    const file = new File([blob], name, { type: blob.type });
    void copyCaption(text).then((ok) =>
      setCaptionMessage(
        ok
          ? "Caption copied. Paste it in Instagram if needed."
          : "Copy the caption below if Instagram does not include it.",
      ),
    );
    try {
      // The poster's big button: counted like the Instagram share button.
      const { token } = useStudio.getState();
      if (token) trackShare(token, "share_opened_instagram");
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        setMessage(
          "Choose Instagram → Post/Feed. Your poster and SKY caption are ready.",
        );
        await navigator.share({
          files: [file],
          title: "My SKY Diwali moment",
          text,
        });
        if (token) trackShare(token, "shared_instagram");
      } else {
        download(blob, name);
        window.open(
          "https://www.instagram.com/",
          "_blank",
          "noopener,noreferrer",
        );
        setMessage(
          "Poster downloaded and Instagram opened. Tap + → Post, choose the poster, and paste the caption.",
        );
      }
    } catch (e) {
      setMessage(
        (e as Error).name === "AbortError"
          ? "Sharing cancelled. Tap Post on Instagram to try again."
          : "Tap Post on Instagram again to open sharing. Your poster and caption are ready.",
      );
    }
  }
  async function shoot() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (completed && poster) {
        await post(poster, caption);
        return;
      }
      let photo;
      if (!product && effect.ready) {
        const source = effect.output.current,
          c = document.createElement("canvas");
        c.width = source.width;
        c.height = source.height;
        const ctx = c.getContext("2d")!;
        if (camera.facingMode === "user") {
          ctx.translate(c.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(source, 0, 0);
        photo = await fromBlob(await canvasBlob(c, "image/jpeg"));
      } else
        photo = await capture(
          camera.videoRef.current!,
          !product && camera.facingMode === "user",
          !product,
        );
      // No blank photos, and a selfie must show a face (when the on-device
      // reader is running, so an empty frame can't pass as a selfie).
      if (looksBlank(photo.image)) throw new Error(BLANK_PHOTO);
      if (
        !product &&
        effect.ready &&
        !(
          import.meta.env.DEV && (window as { skyFakeCue?: unknown }).skyFakeCue
        ) &&
        performance.now() - effect.cues.current.faceAt > FACE_RECENT_MS
      )
        throw new Error(NO_FACE_YET);
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      if (!product) {
        s.setSelfie(photo);
        camera.stop();
        s.setStep("product");
        return;
      }
      s.addProduct(photo);
      camera.stop();
      setCompleted(true);
      await publish();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function publish() {
    setMessage("Preparing your Instagram poster…");
    const current = useStudio.getState();
    if (!current.selfie) throw new Error("Take a selfie first.");
    if (frameAsset(getTemplate(current.template)).status !== "ready")
      throw new Error("The frame is still loading. Please try again.");
    const c = document.createElement("canvas");
    await instagramReady();
    c.width = 1080;
    c.height = POST_HEIGHT;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Could not prepare your poster. Try again.");
    renderInstagramPost(ctx, {
      template: getTemplate(current.template),
      selfie: current.selfie,
      products: current.products,
      logo: current.logo,
      layout: current.layout,
      reward: current.reward,
    });
    // High-quality JPEG: a fraction of the PNG's size, so the share sheet
    // opens fast; Instagram accepts it and recompresses anyway.
    const blob = await canvasBlob(c, "image/jpeg", 0.92);
    c.width = c.height = 1;
    setPoster(blob);
    s.setSavedPoster(blob);
    // No automatic share here (it isn't a tap, so phones would refuse it):
    // the customer taps Post on Instagram, which opens the share sheet.
    setMessage("Your poster is ready! Tap Post on Instagram to share it.");
  }
  function changeTemplate(direction: number) {
    if (completed) return;
    const i = templates.findIndex((t) => t.id === s.template);
    s.setTemplate(
      templates[(i + direction + templates.length) % templates.length].id,
    );
  }
  function retake() {
    s.products.forEach((p) => s.removeProduct(p.id));
    setCompleted(false);
    setPoster(null);
    setMessage("");
    setClosed(false);
  }
  return (
    <div
      className={`workspace camera-workspace inline-product-workspace ${product ? "product-workspace" : ""}`}
    >
      <div className="studio-panel">
        <motion.div
          className="camera-stage"
          drag={completed ? false : "x"}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.12}
          onDragEnd={(_, info) => {
            if (Math.abs(info.offset.x) > 45 || Math.abs(info.velocity.x) > 450)
              changeTemplate(info.offset.x < 0 ? 1 : -1);
          }}
          tabIndex={0}
          onKeyDown={(e) => {
            if (["ArrowRight", "ArrowLeft"].includes(e.key)) {
              e.preventDefault();
              changeTemplate(e.key === "ArrowRight" ? 1 : -1);
            }
          }}
          aria-label={
            product
              ? "Poster with product camera in the small product box"
              : "Selfie poster camera"
          }
        >
          <video
            ref={camera.videoRef}
            autoPlay
            playsInline
            muted
            className="hidden-video"
          />
          <Poster
            chrome
            live={camera.ready && !completed}
            state={{
              template,
              selfie: s.selfie,
              products: s.products,
              logo: s.logo,
              layout: s.layout,
              reward: s.reward,
              video:
                !product && camera.ready
                  ? effect.ready
                    ? effect.output.current
                    : (camera.videoRef.current ?? undefined)
                  : undefined,
              mirror: camera.facingMode === "user",
              productVideo:
                product && camera.ready && !completed
                  ? (camera.videoRef.current ?? undefined)
                  : undefined,
            }}
          />
          {!product && !completed && effect.ready && (
            <div className="auto-capture" aria-live="polite">
              <button
                className={`auto-capture-toggle ${autoCapture ? "on" : ""}`}
                aria-pressed={autoCapture}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setAutoCapture((v) => !v);
                  setCountdown(null);
                }}
              >
                <Sparkles size={13} aria-hidden="true" />
                Auto capture {autoCapture ? "on" : "off"}
              </button>
              {autoCapture && countdown === null && (
                <span className="auto-capture-hint">
                  Smile or show ✌️ 👍 ✋ — the photo takes itself
                </span>
              )}
            </div>
          )}
          {countdown !== null && (
            <div className="auto-countdown" role="status">
              <span key={countdown} className="auto-countdown-number">
                {countdown}
              </span>
              <span className="auto-countdown-cue">{cueLabel}</span>
            </div>
          )}
          {product && !completed && (
            <div
              className="inline-product-hint"
              style={{
                left: `${template.product.x / 10.8}%`,
                top: `${((HEADER + template.product.y) / POST_HEIGHT) * 100}%`,
                width: `${template.product.w / 10.8}%`,
              }}
            >
              <Camera size={12} />
              {camera.ready
                ? "Point at your purchase"
                : "Opening product camera…"}
            </div>
          )}
          <button
            className={`instagram-shutter poster-post-action${
              completed && poster && !busy ? " ready-to-share" : ""
            }`}
            aria-label={
              product && !completed
                ? "Capture product and post on Instagram"
                : "Post on Instagram"
            }
            disabled={
              busy || (!completed && !camera.ready) || (completed && !poster)
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void shoot()}
          >
            <Instagram size={21} aria-hidden="true" />
            <span>
              {busy
                ? "Preparing…"
                : product && !completed
                  ? "Capture product & post"
                  : "Post on Instagram"}
            </span>
          </button>
          {!completed && (
            <button
              className="stage-close icon-button"
              aria-label={closed ? "Resume camera" : "Pause camera"}
              onClick={() => setClosed((v) => !v)}
            >
              {closed ? <Camera size={18} /> : <CameraOff size={18} />}
            </button>
          )}
          {flash && <div className="shutter-flash" />}
          {camera.failure && <CameraAlert failure={camera.failure} retry={camera.retry} />}
        </motion.div>
        <div className="camera-status" role="status">
          {message ||
            camera.error ||
            (product && camera.fallbackNotice) ||
            (!product && camera.ready && effect.status) ||
            (completed
              ? "Poster ready to share."
              : camera.ready
                ? product
                  ? "Selfie saved. Capture your purchase in the small box."
                  : "Tap Post on Instagram to take your selfie."
                : closed
                  ? "Camera paused. Tap the camera icon to resume."
                  : "Starting camera…")}
        </div>
        {camera.error && (
          <button
            className="text-button retry-inline-camera"
            onClick={camera.retry}
          >
            <RefreshCw size={14} /> Retry camera
          </button>
        )}
      </div>
      <aside className="studio-sidebar">
        {!completed ? (
          <Templates />
        ) : (
          <div className="inline-post-actions">
            <button className="text-button" onClick={retake}>
              <RefreshCw size={13} /> Retake product
            </button>
            <button className="text-button" onClick={() => s.setStep("edit")}>
              Edit poster
            </button>
            <button className="text-button" onClick={() => s.reset()}>
              <UserPlus size={13} /> Next customer
            </button>
            {poster && (
              <button
                className="text-button"
                onClick={() =>
                  download(
                    poster,
                    `${filename}.${poster.type === "image/png" ? "png" : "jpg"}`,
                  )
                }
              >
                <Download size={13} /> Download
              </button>
            )}
          </div>
        )}
      </aside>
      {completed && (
        <section className="inline-caption-panel">
          {poster && (
            <ShareButtons
              poster={poster}
              caption={caption}
              filename={`${filename}.jpg`}
            />
          )}
          <label htmlFor="inline-sky-caption">Your SKY Instagram caption</label>
          <textarea
            id="inline-sky-caption"
            readOnly
            rows={5}
            value={caption}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div>
            <button
              className="text-button"
              onClick={() =>
                void copyCaption(caption).then((ok) =>
                  setCaptionMessage(
                    ok
                      ? "Caption copied."
                      : "Select and copy the caption above.",
                  ),
                )
              }
            >
              <Copy size={14} /> Copy caption
            </button>
            <a
              href="https://www.instagram.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-button"
            >
              <ExternalLink size={14} /> Open Instagram
            </a>
          </div>
          <p role="status">{captionMessage}</p>
          <UploadStatus />
          {s.products.length < MAX_PRODUCTS && (
            <button
              className="text-button"
              onClick={() => {
                setCompleted(false);
                setPoster(null);
                setMessage("");
              }}
            >
              Add another product
            </button>
          )}
        </section>
      )}
    </div>
  );
}
