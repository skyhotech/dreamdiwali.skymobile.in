import { initialAdjustment, type Photo } from "./store";
export async function fromBlob(blob: Blob): Promise<Photo> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return {
      id: crypto.randomUUID(),
      image,
      blob,
      url,
      adjust: initialAdjustment(),
      label: "",
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      "This image could not be opened. Choose a JPG, PNG or WebP image.",
    );
  }
}
export async function readPhoto(file: File): Promise<Photo> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Please choose an image smaller than 25 MB.");
  const photo = await fromBlob(file);
  if (photo.image.width * photo.image.height > 60_000_000) {
    URL.revokeObjectURL(photo.url);
    throw new Error("Image is too large. Please choose a smaller photo.");
  }
  const scale = Math.min(
    1,
    2200 / Math.max(photo.image.width, photo.image.height),
  );
  if (scale === 1) return photo;
  const c = document.createElement("canvas");
  c.width = Math.round(photo.image.width * scale);
  c.height = Math.round(photo.image.height * scale);
  c.getContext("2d")!.drawImage(photo.image, 0, 0, c.width, c.height);
  const blob = await canvasBlob(c);
  URL.revokeObjectURL(photo.url);
  return fromBlob(blob);
}
export function canvasBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 0.95,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(
                new Error("Could not export. Try the standard resolution."),
              ),
        type,
        quality,
      );
    } catch {
      reject(new Error("Export failed. Try again with a smaller image."));
    }
  });
}
/** A covered lens, a black or white frame or one flat colour: not a photo. */
export function looksBlank(image: CanvasImageSource) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, 32, 32);
  const px = ctx.getImageData(0, 0, 32, 32).data;
  let sum = 0,
    sq = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    sum += y;
    sq += y * y;
  }
  const mean = sum / n,
    spread = Math.sqrt(Math.max(0, sq / n - mean * mean));
  return mean < 20 || mean > 248 || spread < 6;
}
export const BLANK_PHOTO =
  "Your photo looks blank or too dark. Make sure nothing covers the camera and try again.";
/** Selfie brightening: lifts the picture 10% toward white ("screen" blend,
 *  which works in every browser, unlike canvas filters on iPhone). */
export const BRIGHTEN = 0.1;
export function brighten(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = `rgba(255,255,255,${BRIGHTEN})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
export async function capture(
  video: HTMLVideoElement,
  mirror: boolean,
  bright = false,
): Promise<Photo> {
  if (video.readyState < 2 || !video.videoWidth)
    throw new Error("Camera is still starting. Please try again.");
  const c = document.createElement("canvas"),
    scale = Math.min(1, 2200 / Math.max(video.videoWidth, video.videoHeight));
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  const ctx = c.getContext("2d")!;
  if (mirror) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, c.width, c.height);
  if (bright) brighten(ctx, c.width, c.height);
  return fromBlob(await canvasBlob(c, "image/jpeg"));
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
