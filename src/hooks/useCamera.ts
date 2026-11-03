import { useCallback, useEffect, useRef, useState } from "react";
const messages: Record<string, string> = {
  NotAllowedError:
    "Camera permission was denied. Allow camera access in your browser settings, then retry.",
  NotFoundError: "No camera was found. Connect or enable a camera, then retry.",
  NotReadableError: "The camera is busy. Close other camera apps and retry.",
  SecurityError: "Camera access requires HTTPS or localhost.",
};
// How often to ask again for a refused camera.
const ASK_AGAIN_MS = 4000;
export function useCamera(facing: "user" | "environment", active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null),
    streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [readyFacing, setReadyFacing] = useState(""),
    [facingMode, setFacingMode] = useState<"user" | "environment">(facing),
    [fallbackNotice, setFallbackNotice] = useState(""),
    [retry, setRetry] = useState(0),
    [denied, setDenied] = useState(false),
    // The error's name (NotAllowedError, NotReadableError…), for camera help.
    [failure, setFailure] = useState(""),
    [torch, setTorch] = useState(false),
    [torchSupported, setTorchSupported] = useState(false);
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
    setTorch(false);
  }, []);
  useEffect(() => {
    let cancelled = false;
    stop();
    setError("");
    setFailure("");
    setFallbackNotice("");
    setTorchSupported(false);
    async function start() {
      if (!active || document.hidden) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera access requires HTTPS or localhost.");
        return;
      }
      try {
        let stream: MediaStream,
          selected: "user" | "environment" = facing,
          usedFallback = false;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode:
                facing === "environment"
                  ? { exact: "environment" }
                  : { ideal: "user" },
              width: { ideal: 1920 },
              height: { ideal: 1920 },
            },
            audio: false,
          });
        } catch (e) {
          if (cancelled) return;
          const name = (e as DOMException).name;
          if (
            facing === "environment" &&
            [
              "OverconstrainedError",
              "NotFoundError",
              "NotReadableError",
              "AbortError",
            ].includes(name)
          ) {
            // The selfie stream is already released before requesting the product camera.
            // A missing/unavailable back camera automatically falls back to the front camera.
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: { ideal: "user" },
                width: { ideal: 1920 },
                height: { ideal: 1920 },
              },
              audio: false,
            });
            selected = "user";
            usedFallback = true;
          } else if (facing === "user" && name === "OverconstrainedError") {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } else throw e;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        const track = stream.getVideoTracks()[0],
          actual = track.getSettings?.().facingMode;
        setFacingMode(
          actual === "environment"
            ? "environment"
            : actual === "user"
              ? "user"
              : selected,
        );
        setReadyFacing(facing);
        setReady(true);
        setDenied(false);
        setFallbackNotice(
          usedFallback
            ? "Rear camera unavailable. Using the front camera for your product."
            : "",
        );
        const capabilities = track.getCapabilities?.() as
          (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setTorchSupported(Boolean(capabilities?.torch));
      } catch (e) {
        if (!cancelled) {
          stop();
          setDenied((e as DOMException).name === "NotAllowedError");
          setFailure((e as DOMException).name || "Error");
          setError(
            messages[(e as DOMException).name] ??
              "Could not start a camera. Check permissions and retry.",
          );
        }
      }
    }
    void start();
    const visibility = () => {
      if (document.hidden) stop();
      else setRetry((v) => v + 1);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
      stop();
    };
  }, [active, facing, retry, stop]);
  // Camera refused: keep asking. Browsers re-show the prompt unless it was
  // blocked for good; then we start the moment it's allowed in settings.
  useEffect(() => {
    if (!active || !denied) return;
    const again = () => {
      if (!document.hidden) setRetry((v) => v + 1);
    };
    const timer = window.setInterval(again, ASK_AGAIN_MS);
    let status: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((p) => {
        status = p;
        p.onchange = () => {
          if (p.state !== "denied") again();
        };
      })
      .catch(() => {});
    return () => {
      window.clearInterval(timer);
      if (status) status.onchange = null;
    };
  }, [active, denied]);
  async function toggleTorch() {
    try {
      await streamRef.current
        ?.getVideoTracks()[0]
        .applyConstraints({
          advanced: [{ torch: !torch } as MediaTrackConstraintSet],
        });
      setTorch((v) => !v);
    } catch {
      setError("Flash is unavailable on this camera. Try brighter lighting.");
    }
  }
  return {
    videoRef,
    error,
    ready: ready && readyFacing === facing,
    facingMode,
    fallbackNotice,
    stop,
    retry: () => setRetry((v) => v + 1),
    /** The customer refused the camera; the studio keeps asking. */
    denied,
    failure,
    torch,
    torchSupported,
    toggleTorch,
  };
}
