import { useEffect, useRef, useState, type RefObject } from "react";
import type { FaceLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  applyExpression,
  type Expression,
  type Point,
} from "../lib/expression";
import { createPortraitRenderer, foregroundAlpha } from "../lib/portrait";
export function useExpression(
  video: RefObject<HTMLVideoElement | null>,
  active: boolean,
  expression: Expression,
  intensity: number,
) {
  const [canvas] = useState(() => document.createElement("canvas"));
  const output = useRef(canvas);
  const [status, setStatus] = useState(""),
    [ready, setReady] = useState(false);
  const settings = useRef({ expression, intensity });
  settings.current = { expression, intensity };
  useEffect(() => {
    setReady(false);
    if (!active) {
      setStatus("");
      return;
    }
    let dead = false,
      face: FaceLandmarker | null = null,
      segmenter: ImageSegmenter | null = null,
      timer: ReturnType<typeof setInterval> | undefined;
    const base = document.createElement("canvas"),
      input = document.createElement("canvas"),
      smiling = document.createElement("canvas"),
      mask = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!,
      baseCtx = base.getContext("2d")!,
      inputCtx = input.getContext("2d")!,
      smileCtx = smiling.getContext("2d")!,
      maskCtx = mask.getContext("2d")!;
    const portrait = createPortraitRenderer();
    // Mid-range phones: smaller frames and less frequent AI keep the camera smooth.
    const lowEnd =
      (navigator.hardwareConcurrency || 8) <= 4 ||
      ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
    const maxWidth = lowEnd ? 960 : 1280,
      aiGap = lowEnd ? 320 : 180;
    let points: Point[] = [],
      lastFace = 0,
      lastSegment = 0,
      lastVideoTime = -1,
      hasMask = false;
    let maskPixels: ImageData | null = null;
    const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;
    setStatus("Preparing portrait camera…");
    void (async () => {
      try {
        const { FaceLandmarker, ImageSegmenter, FilesetResolver } =
          await import("@mediapipe/tasks-vision");
        const files = await FilesetResolver.forVisionTasks(baseUrl + "ai");
        if (dead) return;
        // Load independently so a failed optional model never disables the other effect.
        await Promise.allSettled([
          (async () => {
            const loaded = await FaceLandmarker.createFromOptions(files, {
              baseOptions: {
                modelAssetPath: baseUrl + "ai/face_landmarker.task",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              numFaces: 2,
              minFaceDetectionConfidence: 0.7,
              minFacePresenceConfidence: 0.7,
              minTrackingConfidence: 0.7,
            });
            if (dead) loaded.close();
            else face = loaded;
          })(),
          (async () => {
            const loaded = await ImageSegmenter.createFromOptions(files, {
              baseOptions: {
                modelAssetPath: baseUrl + "ai/selfie_segmenter.tflite",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              outputCategoryMask: false,
              outputConfidenceMasks: true,
            });
            if (dead) loaded.close();
            else segmenter = loaded;
          })(),
        ]);
        if (dead) return;
        timer = setInterval(() => {
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
            if (base.width !== w || base.height !== h) {
              base.width = smiling.width = canvas.width = w;
              base.height = smiling.height = canvas.height = h;
              input.width = 480;
              input.height = Math.round((480 * h) / w);
              hasMask = false;
            }
            baseCtx.drawImage(v, 0, 0, w, h);
            inputCtx.drawImage(base, 0, 0, input.width, input.height);
            let ranAi = false;
            if (face && now - lastFace > aiGap) {
              ranAi = true;
              try {
                const result = face.detectForVideo(input, now);
                points =
                  result.faceLandmarks.length === 1
                    ? result.faceLandmarks[0]
                    : [];
              } catch {
                face.close();
                face = null;
                points = [];
              }
              lastFace = now;
            }
            // Never both models in one frame: they take turns.
            if (segmenter && !ranAi && now - lastSegment > aiGap) {
              try {
                segmenter.segmentForVideo(input, now, (result) => {
                  const masks = result.confidenceMasks;
                  const person = masks?.[1] ?? masks?.[0];
                  if (!person) {
                    hasMask = false;
                    return;
                  }
                  if (
                    mask.width !== person.width ||
                    mask.height !== person.height ||
                    !maskPixels
                  ) {
                    mask.width = person.width;
                    mask.height = person.height;
                    maskPixels = maskCtx.createImageData(
                      mask.width,
                      mask.height,
                    );
                  }
                  const confidence = person.getAsFloat32Array(),
                    data = maskPixels.data;
                  for (let i = 0; i < confidence.length; i++) {
                    const n = i * 4;
                    data[n] = data[n + 1] = data[n + 2] = 255;
                    data[n + 3] = foregroundAlpha(confidence[i]);
                  }
                  maskCtx.putImageData(maskPixels, 0, 0);
                  hasMask = true;
                });
              } catch {
                segmenter.close();
                segmenter = null;
                hasMask = false;
              }
              lastSegment = now;
            }
            applyExpression(
              smileCtx,
              base,
              points,
              settings.current.expression,
              settings.current.intensity,
            );
            portrait(ctx, smiling, hasMask ? mask : null);
            setReady(true);
            setStatus(
              !segmenter
                ? "Portrait background unavailable. You can still take a photo."
                : !face
                  ? "Smile effect unavailable. Portrait camera is ready."
                  : "Tap Capture when you’re ready",
            );
          } catch {
            setReady(false);
            setStatus(
              "Camera effects unavailable. You can still take a photo.",
            );
            clearInterval(timer);
          }
        }, lowEnd ? 100 : 80);
      } catch {
        if (!dead)
          setStatus("Camera effects unavailable. You can still take a photo.");
      }
    })();
    return () => {
      dead = true;
      clearInterval(timer);
      face?.close();
      segmenter?.close();
    };
  }, [active, video, canvas]);
  return { output, status, ready };
}
