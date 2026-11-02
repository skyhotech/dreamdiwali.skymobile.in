import { mkdir, copyFile, access, rename, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "public/ai");
await mkdir(target, { recursive: true });
const wasm = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
for (const name of [
  "vision_wasm_internal.wasm",
  "vision_wasm_internal.js",
  "vision_wasm_nosimd_internal.wasm",
  "vision_wasm_nosimd_internal.js",
]) {
  try {
    await copyFile(join(wasm, name), join(target, name));
  } catch {
    console.warn(`AI runtime missing: ${name}. Run npm install again.`);
  }
}
const model = join(target, "face_landmarker.task");
try {
  await access(model);
} catch {
  console.log("Preparing local facial expression model (about 4 MB)…");
  try {
    const response = await fetch(
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      { signal: AbortSignal.timeout(60000) },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(model + ".tmp", bytes),
    );
    await rename(model + ".tmp", model);
  } catch (error) {
    await rm(model + ".tmp", { force: true });
    console.warn(
      "Optional face model unavailable. Manual camera remains functional. Retry npm run setup. " +
        error.message,
    );
  }
}
const portraitModel = join(target, "selfie_segmenter.tflite");
try {
  await access(portraitModel);
} catch {
  console.log("Preparing local portrait background model…");
  try {
    const response = await fetch(
      "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
      { signal: AbortSignal.timeout(60000) },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(portraitModel + ".tmp", bytes),
    );
    await rename(portraitModel + ".tmp", portraitModel);
  } catch (error) {
    await rm(portraitModel + ".tmp", { force: true });
    console.warn(
      "Portrait model unavailable. Manual camera remains functional. Retry npm run setup. " +
        error.message,
    );
  }
}
// Hand-gesture model for hands-free selfies (✌️ 👍 ✋), about 8 MB.
const gestureModel = join(target, "gesture_recognizer.task");
try {
  await access(gestureModel);
} catch {
  console.log("Preparing local hand-gesture model (about 8 MB)…");
  try {
    const response = await fetch(
      "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      { signal: AbortSignal.timeout(60000) },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(gestureModel + ".tmp", bytes),
    );
    await rename(gestureModel + ".tmp", gestureModel);
  } catch (error) {
    await rm(gestureModel + ".tmp", { force: true });
    console.warn(
      "Gesture model unavailable. Smile auto-capture and the shutter still work. Retry npm run setup. " +
        error.message,
    );
  }
}
// Face-match models (repeat-customer check), served from public/ai/face.
const faceSource = join(root, "node_modules/@vladmandic/face-api/model");
const faceTarget = join(target, "face");
await mkdir(faceTarget, { recursive: true });
for (const name of [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",
  "face_landmark_68_tiny_model-weights_manifest.json",
  "face_landmark_68_tiny_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
]) {
  try {
    await copyFile(join(faceSource, name), join(faceTarget, name));
  } catch {
    console.warn(`Face-match model missing: ${name}. Run npm install again.`);
  }
}
console.log("SKY setup complete. No API keys needed. Start with npm run dev.");
