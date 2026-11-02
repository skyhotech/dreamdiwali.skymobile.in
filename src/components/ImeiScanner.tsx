import { useEffect, useRef, useState } from "react";
import { imeiValid } from "../lib/backend";
/** The IMEI inside a barcode's text, which may hold a label or two IMEIs. */
export function findImei(text: string) {
  for (const run of text.replace(/[ -]/g, "").match(/\d{15,}/g) ?? [])
    for (let i = 0; i + 15 <= run.length; i += 15) {
      const imei = run.slice(i, i + 15);
      if (imeiValid(imei)) return imei;
    }
  return "";
}
type Detector = { detect: (c: HTMLCanvasElement) => Promise<{ rawValue: string }[]> };
const FORMATS = ["code_128", "code_39", "ean_13"];
const SCAN_MS = 200;
// Decoders give up on thin bars, so the middle band is enlarged first.
const BAND_HEIGHT = 0.3;
const ZOOM = 2;
function band(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const w = video.videoWidth,
    h = video.videoHeight,
    sh = h * BAND_HEIGHT;
  canvas.width = w * ZOOM;
  canvas.height = sh * ZOOM;
  canvas.getContext("2d")!.drawImage(
    video, 0, (h - sh) / 2, w, sh, 0, 0, canvas.width, canvas.height,
  );
}
// Reads the IMEI with the back camera: the phone's own barcode reader when it
// has one, ZXing otherwise, or OCR of the printed digits on request.
export default function ImeiScanner({
  onScan,
}: {
  onScan: (imei: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState("");
  const [reading, setReading] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let stream: MediaStream | null = null;
    const canvas = document.createElement("canvas");
    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const [track] = stream.getVideoTracks();
      void track
        .applyConstraints({
          advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
        })
        .catch(() => {});
      video.current!.srcObject = stream;
      await video.current!.play();
      const Native = (
        window as { BarcodeDetector?: new (o: object) => Detector }
      ).BarcodeDetector;
      const native = Native && new Native({ formats: FORMATS });
      const zxing = await import("@zxing/browser");
      const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
      const reader = new zxing.BrowserMultiFormatReader(
        new Map<never, unknown>([
          [DecodeHintType.TRY_HARDER as never, true],
          [
            DecodeHintType.POSSIBLE_FORMATS as never,
            [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13],
          ],
        ]),
      );
      const read = async () => {
        if (native) {
          const codes = await native.detect(canvas).catch(() => []);
          if (codes.length) return codes.map((c) => c.rawValue);
        }
        try {
          return [reader.decodeFromCanvas(canvas).getText()];
        } catch {
          return []; // No barcode in this frame.
        }
      };
      const tick = async () => {
        if (stopped) return;
        if (video.current?.videoWidth) {
          band(video.current, canvas);
          for (const text of await read()) {
            const imei = findImei(text);
            if (imei) return onScan(imei);
            setSeen(text.slice(0, 24));
          }
        }
        timer = window.setTimeout(() => void tick(), SCAN_MS);
      };
      void tick();
    }
    start().catch(() =>
      setError("Camera unavailable. Allow it, or type the IMEI instead."),
    );
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);
  async function readDigits() {
    const v = video.current;
    if (!v?.videoWidth || reading) return;
    setReading(true);
    setError("");
    const canvas = document.createElement("canvas");
    band(v, canvas);
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      await worker.setParameters({ tessedit_char_whitelist: "0123456789 -" });
      const { data } = await worker.recognize(canvas);
      const imei = findImei(data.text);
      if (imei) onScan(imei);
      else setError("Couldn't read an IMEI. Hold the digits on the red line.");
    } catch {
      setError("Couldn't read the digits. Try again or type the IMEI.");
    } finally {
      void worker.terminate();
      setReading(false);
    }
  }
  return (
    <>
      <div className="manager-camera">
        <video ref={video} muted playsInline aria-label="IMEI barcode camera" />
      </div>
      <p className="phone-help" role="status">
        {error ||
          (seen
            ? `Read "${seen}", which isn't an IMEI. Try the barcode labelled IMEI.`
            : "Fill the red line with the IMEI barcode, about 10 cm away.")}
      </p>
      <button
        type="button"
        className="manager-scan"
        disabled={reading}
        onClick={() => void readDigits()}
      >
        {reading ? "Reading…" : "Read IMEI digits"}
      </button>
    </>
  );
}
