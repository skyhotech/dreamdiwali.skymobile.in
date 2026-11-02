import { useEffect, useRef, useState } from "react";
import type { DecodeHintType as HintType } from "@zxing/library";
import { imeiValid } from "../lib/backend";
/** The IMEI inside a barcode's text, which may hold a label or two IMEIs. */
export function findImei(text: string) {
  for (const run of text.match(/\d{15,}/g) ?? [])
    for (let i = 0; i + 15 <= run.length; i += 15) {
      const imei = run.slice(i, i + 15);
      if (imeiValid(imei)) return imei;
    }
  return "";
}
// Reads the IMEI barcode with the back camera. Boxes often print several
// barcodes, so only a number that is a real IMEI is accepted.
export default function ImeiScanner({
  onScan,
}: {
  onScan: (imei: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState("");
  useEffect(() => {
    let stopped = false;
    let stop = () => {};
    void import("@zxing/browser")
      .then(async ({ BrowserMultiFormatReader }) => {
        const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
        if (stopped || !video.current) return;
        // IMEI labels are thin barcodes: they need a sharp feed and hard looking.
        const hints = new Map<HintType, unknown>([
          [DecodeHintType.TRY_HARDER, true],
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13],
          ],
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 100,
        });
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          video.current,
          (result) => {
            if (!result) return;
            const imei = findImei(result.getText());
            if (imei) onScan(imei);
            else setSeen(result.getText().slice(0, 24));
          },
        );
        stop = () => controls.stop();
        if (stopped) stop();
      })
      .catch(() =>
        setError("Camera unavailable. Allow it, or type the IMEI instead."),
      );
    return () => {
      stopped = true;
      stop();
    };
  }, [onScan]);
  return (
    <>
      <div className="manager-camera">
        <video ref={video} muted playsInline aria-label="IMEI barcode camera" />
      </div>
      <p className="phone-help" role="status">
        {error ||
          (seen
            ? `Read "${seen}", which isn't an IMEI. Try the barcode labelled IMEI.`
            : "Point the red line at the IMEI barcode.")}
      </p>
    </>
  );
}
