import { useEffect, useRef, useState } from "react";
import { imeiValid } from "../lib/backend";
// Reads the IMEI barcode with the back camera. Boxes often print several
// barcodes, so only a number that is a real IMEI is accepted.
export default function ImeiScanner({
  onScan,
}: {
  onScan: (imei: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let stop = () => {};
    void import("@zxing/browser")
      .then(async ({ BrowserMultiFormatReader }) => {
        if (stopped || !video.current) return;
        const controls = await new BrowserMultiFormatReader().decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          video.current,
          (result) => {
            const text = result?.getText().replace(/\D/g, "") ?? "";
            if (imeiValid(text)) onScan(text);
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
        {error || "Point the red line at the IMEI barcode."}
      </p>
    </>
  );
}
