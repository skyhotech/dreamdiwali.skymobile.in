import type { Template } from "../templates";
import { MEDIA_ORIGIN } from "./backend";
type Asset = {
  image: HTMLImageElement | null;
  status: "loading" | "ready" | "missing";
};
const assets = new Map<string, Asset>();
// Last loaded image per theme id: shown while a new URL for the same theme
// (e.g. the backend copy of a built-in frame) downloads, instead of a blank.
const lastReady = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();
export function subscribeFrames(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function frameAsset(template: Template, priority = true): Asset {
  // Keyed by artwork URL so a re-uploaded theme loads its new image.
  const cached = assets.get(template.artwork);
  if (cached) return cached;
  const previous = lastReady.get(template.id);
  const asset: Asset = previous
    ? { image: previous, status: "ready" }
    : { image: null, status: "loading" };
  assets.set(template.artwork, asset);
  const image = new Image();
  image.decoding = "async";
  // The frame on screen downloads first; background preloads wait their turn.
  image.fetchPriority = priority ? "high" : "low";
  image.onload = () => {
    asset.image = image;
    asset.status = "ready";
    lastReady.set(template.id, image);
    listeners.forEach((fn) => fn());
  };
  image.onerror = () => {
    // Keep showing the previous image for this theme if we have one.
    if (!asset.image) asset.status = "missing";
    listeners.forEach((fn) => fn());
  };
  // Backend artwork arrives as "/media/…" (served by the API's site); built-in
  // frames are relative to the studio. A different API origin needs CORS so
  // the export canvas stays untainted.
  const fromBackend = template.artwork.startsWith("/");
  const url = fromBackend
    ? new URL(MEDIA_ORIGIN + template.artwork, location.href)
    : /^https?:\/\//.test(template.artwork)
      ? new URL(template.artwork)
      : new URL(import.meta.env.BASE_URL + template.artwork, location.href);
  if (url.origin !== location.origin) image.crossOrigin = "anonymous";
  image.src = url.href;
  return asset;
}
/** Downloads the other themes one at a time, after the given one is ready, so
 * background loading never slows the frame the customer is looking at. */
export async function preloadFrames(templates: Template[], firstId?: string) {
  const first = templates.find((t) => t.id === firstId) ?? templates[0];
  if (!first) return;
  await framesSettled([first]);
  for (const t of templates) if (t !== first) await framesSettled([t]);
}
/** Resolves once every current theme's artwork has loaded (or failed). */
export function framesSettled(templates: Template[]) {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (templates.every((t) => frameAsset(t, false).status !== "loading")) {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = subscribeFrames(check);
    check();
  });
}
