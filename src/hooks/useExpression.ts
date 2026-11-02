import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  FaceLandmarker,
  GestureRecognizer,
} from "@mediapipe/tasks-vision";
import { brighten } from "../lib/images";
// The selfie camera: the natural picture, brightened slightly, plus on-device
// smile and hand-gesture reading for hands-free capture. No face reshaping
// and no background blur.
export function useExpression(
  video: RefObject<HTMLVideoElement | null>,
  active: boolean,
) {
  const [canvas] = useState(() => document.createElement("canvas"));
  const output = useRef(canvas);
  const [status, setStatus] = useState(""),
    [ready, setReady] = useState(false);
  /** Latest smile strength (0–1) and hand gesture, for hands-free capture. */
  const cues = useRef({ smile: 0, gesture: "" });
  useEffect(() => {
    setReady(false);
    if (!active) {
      setStatus("");
      return;
    }
    let dead = false,
      face: FaceLandmarker | null = null,
      gestures: GestureRecognizer | null = null,
      timer: ReturnType<typeof setInterval> | undefined;
    const input = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!,
      inputCtx = input.getContext("2d")!;
    // Mid-range phones: smaller frames and less frequent AI keep the camera smooth.
    const lowEnd =
      (navigator.hardwareConcurrency || 8) <= 4 ||
      ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
        8) <= 4;
    const maxWidth = lowEnd ? 960 : 1280,
      aiGap = lowEnd ? 320 : 180;
    let lastFace = 0,
      lastGesture = 0,
      lastVideoTime = -1;
    const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;
    setStatus("Preparing camera…");
    void (async () => {
      try {
        const { FaceLandmarker, GestureRecognizer, FilesetResolver } =
          await import("@mediapipe/tasks-vision");
        const files = await FilesetResolver.forVisionTasks(baseUrl + "ai");
        if (dead) return;
        // Load independently so a failed optional model never disables the other.
        await Promise.allSettled([
          (async () => {
            const loaded = await FaceLandmarker.createFromOptions(files, {
              baseOptions: {
                modelAssetPath: baseUrl + "ai/face_landmarker.task",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              numFaces: 1,
              outputFaceBlendshapes: true,
              minFaceDetectionConfidence: 0.7,
              minFacePresenceConfidence: 0.7,
              minTrackingConfidence: 0.7,
            });
            if (dead) loaded.close();
            else face = loaded;
          })(),
          // Hand gestures are a second model: only on phones with headroom.
          (async () => {
            if (lowEnd) return;
            const loaded = await GestureRecognizer.createFromOptions(files, {
              baseOptions: {
                modelAssetPath: baseUrl + "ai/gesture_recognizer.task",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              numHands: 1,
            });
            if (dead) loaded.close();
            else gestures = loaded;
          })(),
        ]);
        if (dead) return;
        timer = setInterval(
          () => {
            const v = video.current;
            if (
              dead ||
              document.hidden ||
              !v ||
              v.readyState < 2 ||
              v.currentTime === lastVideoTime
            )
              return;
            lastVideoTime = v.currentTime;
            try {
              const now = performance.now(),
                w = Math.min(maxWidth, v.videoWidth),
                h = Math.round((w * v.videoHeight) / v.videoWidth);
              if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                input.width = 480;
                input.height = Math.round((480 * h) / w);
              }
              ctx.drawImage(v, 0, 0, w, h);
              // The AI reads the untouched frame; the customer sees it brightened.
              inputCtx.drawImage(canvas, 0, 0, input.width, input.height);
              brighten(ctx, w, h);
              let ranAi = false;
              if (face && now - lastFace > aiGap) {
                ranAi = true;
                try {
                  const result = face.detectForVideo(input, now);
                  const shapes = result.faceBlendshapes?.[0]?.categories ?? [];
                  const score = (name: string) =>
                    shapes.find((c) => c.categoryName === name)?.score ?? 0;
                  cues.current.smile = result.faceLandmarks.length
                    ? (score("mouthSmileLeft") + score("mouthSmileRight")) / 2
                    : 0;
                } catch {
                  face.close();
                  face = null;
                  cues.current.smile = 0;
                }
                lastFace = now;
              }
              // Never both models in one frame: they take turns.
              if (gestures && !ranAi && now - lastGesture > aiGap * 1.5) {
                try {
                  const top = gestures.recognizeForVideo(input, now)
                    .gestures[0]?.[0];
                  cues.current.gesture =
                    top && top.score > 0.6 ? top.categoryName : "";
                } catch {
                  gestures.close();
                  gestures = null;
                  cues.current.gesture = "";
                }
                lastGesture = now;
              }
              setReady(true);
              setStatus("Tap Capture when you’re ready");
            } catch {
              setReady(false);
              setStatus(
                "Camera effects unavailable. You can still take a photo.",
              );
              clearInterval(timer);
            }
          },
          lowEnd ? 100 : 80,
        );
      } catch {
        if (!dead)
          setStatus("Camera effects unavailable. You can still take a photo.");
      }
    })();
    return () => {
      dead = true;
      clearInterval(timer);
      face?.close();
      gestures?.close();
      cues.current = { smile: 0, gesture: "" };
    };
  }, [active, video, canvas]);
  return { output, status, ready, cues };
}
