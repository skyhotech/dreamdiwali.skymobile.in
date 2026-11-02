import { useEffect, useRef, useState } from "react";
import {
  Download,
  Share2,
  Instagram,
  ArrowLeft,
  ArrowRight,
  Move,
  RotateCcw,
  Camera,
  Check,
  SlidersHorizontal,
  Copy,
  ExternalLink,
  UserPlus,
} from "lucide-react";
import { motion } from "motion/react";
import { useStudio, type Photo } from "../lib/store";
import { getTemplate, templates } from "../templates";
import {
  instagramReady,
  renderInstagramPost,
  POST_HEIGHT,
} from "../lib/instagram";
import { canvasBlob, download } from "../lib/images";
import { Poster } from "./Poster";
import { SpinWheel } from "./SpinWheel";
import { UploadStatus } from "./StatusNotices";
import { spinPrize } from "../lib/backend";
import { Templates } from "./Templates";
import { frameAsset, subscribeFrames } from "../lib/frameAssets";
import { instagramCaption, copyCaption } from "../lib/sharing";
// Kiosk mode: customers only pick a frame and post. Flip to true to bring
// back photo adjustments, layout, format, caption and the generate flow.
const SHOW_EDIT_CONTROLS = false;
export default function Editor() {
  const s = useStudio();
  // A reload between the product photo and claiming the prize lands here;
  // reopen the wheel (it lands on the already-locked prize, if any).
  // No photo, no wheel.
  const [wheelOpen, setWheelOpen] = useState(
    () => Boolean(s.selfie) && s.products.length > 0 && !s.reward,
  );
  const [selected, setSelected] = useState("selfie"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [blob, setBlob] = useState<Blob | null>(s.savedPoster),
    [format, setFormat] = useState(s.savedPoster?.type || "image/png"),
    [scale, setScale] = useState(1),
    [notice, setNotice] = useState("");
  const [prepared, setPrepared] = useState<Blob | null>(null),
    [assetVersion, setAssetVersion] = useState(0),
    [captionNote, setCaptionNote] = useState(""),
    [sharing, setSharing] = useState(false);
  const caption = instagramCaption(
    s.products.length,
    s.products.map((p) => p.label),
  );
  useEffect(() => subscribeFrames(() => setAssetVersion((v) => v + 1)), []);
  useEffect(() => {
    setPrepared(null);
    let cancelled = false;
    if (
      !s.selfie ||
      !s.products.length ||
      frameAsset(getTemplate(s.template)).status !== "ready"
    )
      return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const c = document.createElement("canvas");
          await instagramReady();
          c.width = 1080 * scale;
          c.height = POST_HEIGHT * scale;
          const ctx = c.getContext("2d");
          if (!ctx)
            throw new Error("Not enough memory to prepare your poster.");
          ctx.scale(scale, scale);
          renderInstagramPost(ctx, {
            template: getTemplate(s.template),
            selfie: s.selfie,
            products: s.products,
            logo: s.logo,
            layout: s.layout,
            reward: s.reward,
          });
          const output = await canvasBlob(c, format);
          c.width = c.height = 1;
          if (!cancelled) setPrepared(output);
        } catch (e) {
          if (!cancelled) setError((e as Error).message);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    s.selfie,
    s.products,
    s.template,
    s.catalog,
    s.reward,
    s.layout,
    s.logo,
    scale,
    format,
    assetVersion,
  ]);
  const drag = useRef<{
      x: number;
      y: number;
      ax: number;
      ay: number;
      distance?: number;
      zoom: number;
    } | null>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>());
  const result = s.step === "result";
  const photo: Photo | null =
    selected === "selfie"
      ? s.selfie
      : (s.products.find((p) => p.id === selected) ?? null);
  const state = {
    template: getTemplate(s.template),
    selfie: s.selfie,
    products: s.products,
    logo: s.logo,
    layout: s.layout,
    reward: s.reward,
  };
  async function generate() {
    setBusy(true);
    setError("");
    try {
      if (frameAsset(getTemplate(s.template)).status !== "ready")
        throw new Error(
          "The original frame image must be installed before exporting.",
        );
      await new Promise((r) => setTimeout(r, 40));
      const c = document.createElement("canvas");
      await instagramReady();
      c.width = 1080 * scale;
      c.height = POST_HEIGHT * scale;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("Not enough memory. Try standard resolution.");
      ctx.scale(scale, scale);
      renderInstagramPost(ctx, state);
      const generated = await canvasBlob(c, format);
      setBlob(generated);
      s.setSavedPoster(generated);
      c.width = 1;
      c.height = 1;
      s.setStep("result");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filename = `SKY-Diwali-${getTemplate(s.template).id}.${format === "image/png" ? "png" : "jpg"}`;
  async function share(instagram = false) {
    const poster = result ? blob : prepared;
    if (!poster || !s.selfie || !s.products.length) {
      setNotice(
        "Capture your selfie and product photo first, then wait for the poster to finish preparing.",
      );
      return;
    }
    setNotice("");
    setSharing(true);
    const file = new File([poster], filename, { type: poster.type });
    // Start clipboard copy without awaiting it: native sharing needs this click's activation.
    if (instagram)
      void copyCaption(caption).then((ok) =>
        setCaptionNote(
          ok
            ? "Caption copied. Paste it in Instagram if it is not filled in."
            : "Copy the caption below and paste it into Instagram.",
        ),
      );
    try {
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        setNotice(
          instagram
            ? "Choose Instagram → Post or Feed in the share sheet. Paste the caption if Instagram does not include it."
            : "Choose an app in the share sheet.",
        );
        await navigator.share({
          files: [file],
          title: "My SKY Diwali moment",
          text: caption,
        });
      } else {
        download(poster, filename);
        if (instagram) {
          window.open(
            "https://www.instagram.com/",
            "_blank",
            "noopener,noreferrer",
          );
          setNotice(
            "Poster downloaded and Instagram opened. Tap + → Post, choose the saved poster, then paste the caption. If no tab opened, use Open Instagram below.",
          );
        } else
          setNotice(
            "Sharing is unavailable here. Your poster has been downloaded.",
          );
      }
    } catch (e) {
      if ((e as Error).name === "AbortError")
        setNotice(
          "Sharing cancelled. Your poster and caption are still ready.",
        );
      else
        setNotice(
          "Sharing could not open. Download the poster, then use Open Instagram and paste the caption.",
        );
    } finally {
      setSharing(false);
    }
  }
  async function copy() {
    const ok = await copyCaption(caption);
    setCaptionNote(
      ok
        ? "Caption copied. Paste it into your Instagram post."
        : "Clipboard is unavailable. Select and copy the caption below.",
    );
  }
  const captionPanel = (
    <section className="instagram-caption">
      <label htmlFor="instagram-caption">Your SKY Instagram caption</label>
      <textarea
        id="instagram-caption"
        value={caption}
        readOnly
        rows={7}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div>
        <button className="text-button" onClick={() => void copy()}>
          <Copy size={14} /> Copy caption
        </button>
        <a
          className="text-button"
          href="https://www.instagram.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} /> Open Instagram
        </a>
      </div>
      <p role="status">{captionNote}</p>
      <p className="small muted">
        Select Instagram → Post/Feed, then paste this caption if needed. Your
        device chooses the available sharing apps.
      </p>
    </section>
  );
  function adjust(key: "x" | "y" | "zoom", value: number) {
    if (photo) s.updatePhoto(photo.id, { [key]: value });
  }
  return (
    <div className="workspace editor-workspace">
      {wheelOpen && (
        <SpinWheel
          getPrize={({ onQueue }) =>
            spinPrize(s.phone ?? "", s.selfie?.blob, onQueue)
          }
          onClaim={(r) => {
            s.setReward(r.id);
            setWheelOpen(false);
          }}
        />
      )}
      <div className="studio-panel">
        <div className="panel-heading">
          <span className="eyebrow">
            {result ? "MADE BY YOU. READY TO SHINE." : "03 / MAKE IT YOURS"}
          </span>
          <h1>
            {result
              ? "Your Diwali, beautifully framed."
              : "The finishing touches."}
          </h1>
          <p>
            {result
              ? "A smile, a new purchase, and a moment worth sharing."
              : "Fine-tune your photos. We’ll take care of the festive feeling."}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`editor-poster ${result ? "result-poster" : ""}`}
          style={{ touchAction: result ? "auto" : "none" }}
          onPointerDown={(e) => {
            if (result || !photo) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const ps = [...pointers.current.values()];
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              ax: photo.adjust.x,
              ay: photo.adjust.y,
              zoom: photo.adjust.zoom,
              distance:
                ps.length === 2
                  ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)
                  : undefined,
            };
          }}
          onPointerMove={(e) => {
            if (!drag.current || !photo || result) return;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const ps = [...pointers.current.values()],
              d = drag.current;
            if (ps.length === 2 && d.distance) {
              adjust(
                "zoom",
                Math.max(
                  0.5,
                  Math.min(
                    3,
                    (d.zoom *
                      Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)) /
                      d.distance,
                  ),
                ),
              );
            } else {
              const r = e.currentTarget.getBoundingClientRect();
              s.updatePhoto(photo.id, {
                x: Math.max(
                  -1,
                  Math.min(1, d.ax + ((e.clientX - d.x) / r.width) * 2),
                ),
                y: Math.max(
                  -1,
                  Math.min(1, d.ay + ((e.clientY - d.y) / r.height) * 2),
                ),
              });
            }
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
            drag.current = null;
          }}
          onPointerCancel={() => {
            pointers.current.clear();
            drag.current = null;
          }}
        >
          <Poster chrome state={state} />
          <button
            className="instagram-post-button poster-post-action"
            aria-label="Post on Instagram"
            disabled={
              sharing ||
              !(result ? blob : prepared) ||
              !s.selfie ||
              !s.products.length
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void share(true)}
          >
            <Instagram size={19} aria-hidden="true" />
            <span>{sharing ? "Opening sharing…" : "Post on Instagram"}</span>
          </button>
          {!result && (
            <div className="drag-hint">
              <Move size={13} /> Drag to reposition{" "}
              {selected === "selfie" ? "selfie" : "product"}
            </div>
          )}
        </motion.div>
        <div className="under-preview">
          <span>
            <Check size={14} />{" "}
            {scale === 2
              ? `2160 × ${POST_HEIGHT * 2}`
              : `1080 × ${POST_HEIGHT}`}{" "}
            px
          </span>
          <span>Processed on your device</span>
        </div>
      </div>
      <aside className="studio-sidebar editor-sidebar">
        {result ? (
          <>
            <div className="success-icon">
              <Check size={28} />
            </div>
            <span className="eyebrow">A MOMENT WORTH KEEPING</span>
            <h2>
              Let your celebration
              <br />
              travel a little further.
            </h2>
            <p className="muted">
              Your high-resolution poster is ready. Download it, send it to
              someone you love, or add it to your story.
            </p>
            <button
              className="primary wide"
              onClick={() => blob && download(blob, filename)}
              disabled={!blob}
            >
              <Download size={18} /> Download Poster
            </button>
            <button
              className="secondary wide"
              onClick={() => void share()}
              disabled={!blob}
            >
              <Share2 size={18} /> Share Poster
            </button>
            {captionPanel}
            <div className="result-links">
              <button className="text-button" onClick={() => s.setStep("edit")}>
                <ArrowLeft size={15} /> Back to editing
              </button>
              <button className="text-button" onClick={s.reset}>
                <RotateCcw size={15} /> Create another
              </button>
            </div>
            <p role="status" className="notice">
              {notice}
            </p>
          </>
        ) : (
          <>
            <Templates />
            <UploadStatus />
            <button className="text-button next-customer" onClick={s.reset}>
              <UserPlus size={15} /> Next customer
            </button>
            {SHOW_EDIT_CONTROLS && (
              <>
                <div className="editor-section">
                  <h3>
                    <SlidersHorizontal size={17} /> Photo adjustments
                  </h3>
                  <div className="photo-select">
                    <button
                      className={selected === "selfie" ? "active" : ""}
                      onClick={() => setSelected("selfie")}
                    >
                      Selfie
                    </button>
                    {s.products.map((p, i) => (
                      <button
                        key={p.id}
                        className={selected === p.id ? "active" : ""}
                        onClick={() => setSelected(p.id)}
                      >
                        Product {i + 1}
                      </button>
                    ))}
                  </div>
                  {photo && (
                    <>
                      <label className="range-label">
                        Zoom <span>{photo.adjust.zoom.toFixed(1)}×</span>
                        <input
                          type="range"
                          min="0.5"
                          max="3"
                          step="0.05"
                          value={photo.adjust.zoom}
                          onChange={(e) => adjust("zoom", +e.target.value)}
                        />
                      </label>
                      <div className="range-pair">
                        <label className="range-label">
                          Horizontal
                          <input
                            type="range"
                            min="-1"
                            max="1"
                            step=".01"
                            value={photo.adjust.x}
                            onChange={(e) => adjust("x", +e.target.value)}
                          />
                        </label>
                        <label className="range-label">
                          Vertical
                          <input
                            type="range"
                            min="-1"
                            max="1"
                            step=".01"
                            value={photo.adjust.y}
                            onChange={(e) => adjust("y", +e.target.value)}
                          />
                        </label>
                      </div>
                      {selected !== "selfie" && (
                        <label className="field-label">
                          Product caption (optional)
                          <input
                            className="text-input"
                            maxLength={36}
                            value={photo.label}
                            placeholder="A little something new"
                            onChange={(e) =>
                              s.setLabel(photo.id, e.target.value)
                            }
                          />
                        </label>
                      )}
                      <button
                        className="text-button small"
                        onClick={() =>
                          s.updatePhoto(photo.id, { x: 0, y: 0, zoom: 1 })
                        }
                      >
                        <RotateCcw size={13} /> Reset position
                      </button>
                    </>
                  )}
                </div>
                <div className="editor-section">
                  <h3>Product presentation</h3>
                  <div className="segmented">
                    {(["card", "spotlight", "gallery"] as const).map((l) => (
                      <button
                        key={l}
                        className={s.layout === l ? "active" : ""}
                        onClick={() => s.setLayout(l)}
                      >
                        {l === "card"
                          ? "Photo card"
                          : l === "spotlight"
                            ? "Spotlight"
                            : "Gallery"}
                      </button>
                    ))}
                  </div>
                  <p className="small muted">
                    All {s.products.length} product photos stay in your poster.
                    Pinch to zoom on touch screens.
                  </p>
                </div>
                <div className="export-settings">
                  <label>
                    Format
                    <select
                      value={format}
                      onChange={(e) => setFormat(e.target.value)}
                    >
                      <option value="image/png">PNG · highest quality</option>
                      <option value="image/jpeg">JPEG · smaller file</option>
                    </select>
                  </label>
                  <label>
                    Resolution
                    <select
                      value={scale}
                      onChange={(e) => setScale(+e.target.value)}
                    >
                      <option value={1}>1080 × {POST_HEIGHT}</option>
                      <option value={2}>2160 × {POST_HEIGHT * 2} · 2×</option>
                    </select>
                  </label>
                </div>
                {captionPanel}
                <p role="status" className="notice">
                  {notice}
                </p>
                <button
                  className="secondary wide"
                  onClick={() => void generate()}
                  disabled={busy}
                >
                  {busy ? "Creating your poster…" : "Generate my poster"}
                  <ArrowRight size={18} />
                </button>
                <div className="result-links">
                  <button
                    className="text-button small"
                    onClick={() => s.setStep("selfie")}
                  >
                    <Camera size={14} /> Retake selfie
                  </button>
                  <button
                    className="text-button small"
                    onClick={() => s.setStep("product")}
                  >
                    <Camera size={14} /> Edit purchases
                  </button>
                </div>
              </>
            )}
            <p className="error" role="alert">
              {error}
            </p>
            {SHOW_EDIT_CONTROLS && (
              <div className="template-keyboard">
                <button
                  onClick={() => {
                    const i = templates.findIndex((t) => t.id === s.template);
                    s.setTemplate(
                      templates[(i + templates.length - 1) % templates.length]
                        .id,
                    );
                  }}
                  aria-label="Previous poster template"
                >
                  ←
                </button>
                <span>Explore another frame</span>
                <button
                  onClick={() => {
                    const i = templates.findIndex((t) => t.id === s.template);
                    s.setTemplate(templates[(i + 1) % templates.length].id);
                  }}
                  aria-label="Next poster template"
                >
                  →
                </button>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
