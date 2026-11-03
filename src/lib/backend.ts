import { withLoader } from "./loading";
import { replaceTemplates, type Template } from "../templates";

// Same-origin by default (Vite proxies /api in dev); set VITE_API_URL otherwise.
/** Backend origin; empty when the studio and API share one site. */
export const API_ORIGIN = (
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "https://87.232.72.141" : "")
).replace(/\/$/, "");
const API = API_ORIGIN + "/api";
/** Where /media files load from. On Vercel they go through its CDN (see
 *  vercel.json), so each image leaves the VPS once and loads from nearby. */
export const MEDIA_ORIGIN =
  typeof location !== "undefined" && location.hostname.endsWith(".vercel.app")
    ? ""
    : API_ORIGIN;
// Fallback when the event stream is unavailable (e.g. a proxy that buffers it).
export const POLL_MS = 30_000;

let lastPayload = "";
let lastVersion = "";
let inFlight = false;

function apply(text: string) {
  if (text === lastPayload) return;
  lastPayload = text;
  replaceTemplates(JSON.parse(text) as Template[]);
}

async function pollMirrors() {
  if (inFlight) return;
  inFlight = true;
  try {
    const v = await fetch(`${API}/mirrors/version/`, { cache: "no-store" });
    if (!v.ok) return;
    const { version } = (await v.json()) as { version: string };
    if (version === lastVersion) return;

    const res = await fetch(`${API}/mirrors/`, { cache: "no-store" });
    if (!res.ok) return;
    lastVersion = version;
    apply(await res.text());
  } catch {
    // Offline or backend down: keep showing the current themes.
  } finally {
    inFlight = false;
  }
}

export function startMirrorSync() {
  // The server pushes the theme list the instant an admin saves.
  let stream: EventSource | null = null;
  // Only same-origin (local) backends stream; the VPS turns streaming off to
  // save threads, so the studio just checks the version every second there.
  if (typeof EventSource !== "undefined" && !API_ORIGIN) {
    stream = new EventSource(`${API}/mirrors/stream/`);
    stream.addEventListener("mirrors", (e) => {
      try {
        apply((e as MessageEvent<string>).data);
      } catch {
        // Ignore a malformed event; the next one replaces it.
      }
    });
  }
  const streaming = () => stream?.readyState === EventSource.OPEN;
  void pollMirrors();
  const timer = setInterval(() => {
    if (!streaming() && document.visibilityState === "visible")
      void pollMirrors();
  }, POLL_MS);
  // Catch up immediately when a kiosk tab regains focus.
  const wake = () => {
    if (document.visibilityState === "visible") void pollMirrors();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  return () => {
    stream?.close();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
  };
}

// Indian mobile (10 digits, starts 6–9) that doesn't look made up: rejects one
// digit repeated (9999999999), a digit then zeros (9000000000), a repeated pair
// (9898989898) or half (9876598765), and straight counting up or down with
// wrap-around (9876543210, 6789012345). Kept in sync with PHONE_REGEX in
// backend/mirrors/serializers.py.
const COUNTING = Array.from({ length: 10 }, (_, i) => [
  "0123456789".repeat(2).slice(i, i + 10),
  "9876543210".repeat(2).slice(i, i + 10),
]).flat();
export const PHONE_PATTERN = new RegExp(
  String.raw`^(?!(\d)\1{9}$)(?!\d0{9}$)(?!(\d\d)\2{4}$)(?!(\d{5})\3$)` +
    `(?!(?:${COUNTING.join("|")})$)[6-9]\\d{9}$`,
);
// Customer-facing messages; technical details never reach the screen.
export const ERRORS = {
  offline: "You're offline. Check the Wi-Fi or mobile data and try again.",
  unreachable: "Can't reach SKY right now. Please try again in a moment.",
  timeout: "SKY is taking too long to respond. Please try again.",
  server: "Something went wrong on our side. Please try again in a moment.",
  busy: (seconds: number) =>
    `Too many tries. Please wait ${
      seconds < 90
        ? `${seconds} second${seconds === 1 ? "" : "s"}`
        : `${Math.ceil(seconds / 60)} minutes`
    } and try again.`,
};
const REQUEST_TIMEOUT_MS = 15_000;
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    /** Seconds the server asked us to wait (busy or rate-limited). */
    readonly retryAfter = 0,
  ) {
    super(message);
  }
}
// The store whose link or QR code opened the studio (?branch=…). Remembered,
// so a counter tablet stays on its branch across reloads and customers.
const BRANCH_KEY = "sky-branch";
export const BRANCH: string = (() => {
  try {
    const fromLink = (new URLSearchParams(location.search).get("branch") ?? "")
      .trim()
      .toLowerCase();
    if (fromLink) localStorage.setItem(BRANCH_KEY, fromLink);
    return fromLink || localStorage.getItem(BRANCH_KEY) || "";
  } catch {
    return "";
  }
})();
// A double tap sends one request: an identical one already on its way is shared.
const pendingPosts = new Map<string, Promise<unknown>>();
function postJson<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const key = body instanceof FormData ? "" : path + JSON.stringify(body);
  const running = key && pendingPosts.get(key);
  if (running) return running as Promise<T>;
  // The wheel shows its own spin; everything else shows the SKY loader.
  const send = sendJson<T>(path, body, headers);
  const request = path === "/customers/spin/" ? send : withLoader(send);
  if (key) {
    pendingPosts.set(key, request);
    void request.finally(() => pendingPosts.delete(key)).catch(() => {});
  }
  return request;
}
async function sendJson<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  if (!navigator.onLine) throw new ApiError(ERRORS.offline);
  let res: Response;
  try {
    const form = body instanceof FormData;
    res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        ...(form ? undefined : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * (form ? 3 : 1)),
    });
  } catch (e) {
    throw new ApiError(
      (e as Error).name === "TimeoutError"
        ? ERRORS.timeout
        : navigator.onLine
          ? ERRORS.unreachable
          : ERRORS.offline,
    );
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const wait = Number(res.headers.get("Retry-After")) || 0;
    if (res.status === 429)
      throw new ApiError(ERRORS.busy(Math.ceil(wait || 30)), 429, wait || 30);
    if (res.status === 503) throw new ApiError(ERRORS.server, 503, wait || 10);
    if (res.status >= 500) throw new ApiError(ERRORS.server, res.status);
    // Validation errors come back as {field: [message]}; show the first.
    const detail = Object.values(data).flat()[0];
    throw new ApiError(
      typeof detail === "string" ? detail : ERRORS.unreachable,
      res.status,
    );
  }
  return data as T;
}
// The secret from the customer's WhatsApp link (?spin=…).
export const SPIN_TOKEN =
  typeof location === "undefined"
    ? ""
    : (new URLSearchParams(location.search).get("spin") ?? "");
/** Who a WhatsApp link belongs to; their prize if they already spun. */
export const fetchLink = (token: string) => withLoader(readLink(token));
async function readLink(token: string) {
  let res: Response;
  try {
    res = await fetch(`${API}/customers/link/${encodeURIComponent(token)}/`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(ERRORS.unreachable);
  }
  const data = (await res.json().catch(() => ({}))) as {
    phone?: string;
    reward?: string | null;
    items?: { id: string; label: string; image: string }[];
    poster?: string | null;
    name?: string;
    next?: string;
    video_review?: boolean;
    detail?: string;
  };
  if (!res.ok || !data.phone)
    throw new ApiError(data.detail ?? ERRORS.server, res.status);
  return {
    phone: data.phone,
    reward: data.reward ?? null,
    name: data.name ?? "",
    items: data.items ?? [],
    poster: data.poster ? MEDIA_ORIGIN + data.poster : null,
    reviewed: !["terms", "spin", "review"].includes(data.next ?? ""),
    termsAccepted: data.next !== "terms",
    videoReview: Boolean(data.video_review),
  };
}
export type BranchOption = { slug: string; name: string; phone?: string };
/** Active stores for the manager page. */
export async function fetchManagerBranches() {
  let res: Response;
  try {
    res = await fetch(`${API}/manager/branches/`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(ERRORS.unreachable);
  }
  if (!res.ok) throw new ApiError(ERRORS.server, res.status);
  return (await res.json()) as BranchOption[];
}
// Phone photos are several MB; this size still reads perfectly and uploads fast.
const UPLOAD_SIDE = 2600;
async function shrinkPhoto(file: File): Promise<Blob> {
  if (file.type === "application/pdf" || file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_SIDE / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * scale);
    c.height = Math.round(bitmap.height * scale);
    c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) =>
      c.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.92),
    );
  } catch {
    return file;
  }
}
/** Django reads the invoice (PDF text, or enhanced OCR) and keeps the
 *  reading for the check; the text comes back to fill in the form. */
export async function scanInvoice(file: File | Blob, name = "invoice") {
  const form = new FormData();
  const upload = file instanceof File ? await shrinkPhoto(file) : file;
  const pdf = upload.type === "application/pdf";
  form.append("invoice", upload, pdf ? "invoice.pdf" : `${name}.jpg`);
  return postJson<{ scan: string; text: string }>("/manager/scan/", form);
}
/** Validates and saves the purchase; returns the customer's spin link. */
export const checkPurchase = (form: FormData) =>
  postJson<{ phone: string; link: string }>("/manager/check/", form);
/** Accepts the terms; the video pledge brings the customer's Instagram ID. */
export const acceptTerms = (
  token: string,
  videoReview: boolean,
  instagramId: string,
) =>
  postJson<{ next: string }>("/customers/terms/", {
    token,
    accept: true,
    video_review: videoReview,
    instagram_id: instagramId,
  });
/** Star rating and review, sent once after the spin. */
export const sendReview = (token: string, rating: number, review: string) =>
  postJson<{ next: string }>("/customers/review/", { token, rating, review });
// One id per open tab, so the admin can count who is on the site right now.
const LIVE_MS = 30_000;
// The screen is read when each ping goes out, so the admin sees where they are.
export function startLivePing() {
  const id = Math.random().toString(36).slice(2);
  const ping = () => {
    if (document.visibilityState !== "visible") return;
    const screen =
      document.querySelector("main h1")?.textContent?.slice(0, 40) ??
      (document.querySelector(".camera-stage") ? "Mirror camera" : "");
    void fetch(`${API}/live/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        role: SPIN_TOKEN ? "customer" : "manager",
        screen,
      }),
      keepalive: true,
    }).catch(() => {});
  };
  ping();
  setInterval(ping, LIVE_MS);
  document.addEventListener("visibilitychange", ping);
}
/** Phones have a 15-digit IMEI that passes the Luhn check; other products
 *  print a serial in any format. Kept in sync with validate_imei in
 *  backend/mirrors/serializers.py. */
export function imeiOrSerialValid(value: string) {
  const v = value.trim();
  return /^\d{15}$/.test(v) ? imeiValid(v) : /^[A-Z0-9][A-Z0-9_-]{3,29}$/i.test(v);
}
/** Timeline entries; a lost one must never interrupt the customer. */
export function trackSent(phone: string) {
  void fetch(`${API}/manager/sent/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
    keepalive: true,
  }).catch(() => {});
}
/** kind: share_opened_<platform>, shared_<platform> or posted_<platform>. */
export function trackShare(token: string, kind: string, url?: string) {
  void fetch(`${API}/customers/event/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, kind, ...(url && { url }) }),
    keepalive: true,
  }).catch(() => {});
}
/** The Instagram ID or Facebook profile the customer shares from. */
export const saveProfile = (
  token: string,
  platform: "instagram" | "facebook",
  handle: string,
) =>
  postJson<{ handle: string }>("/customers/profile/", { token, platform, handle });
/** Records the link to the customer's own post, as proof they posted
 *  (WhatsApp has no post link: the customer's confirmation is sent alone). */
export const savePostLink = (token: string, platform: string, url = "") =>
  postJson<{ ok: boolean }>("/customers/event/", {
    token,
    kind: `posted_${platform}`,
    ...(url && { url }),
  });
/** Instagram and WhatsApp are done: the server unlocks the gift. */
export const unlockGift = (token: string) =>
  postJson<{ ok: boolean }>("/customers/event/", { token, kind: "gift_unlocked" });
// The uploaded poster's public address, once the server has it.
let posterUrl = "";
export const getPosterUrl = () => posterUrl;
const absolute = (url: string) =>
  url.startsWith("http") ? url : new URL(url, location.href).href;
// A phone's IMEI is 15 digits passing the Luhn check. Kept in sync with
// imei_valid in backend/mirrors/serializers.py.
export function imeiValid(imei: string) {
  if (!/^\d{15}$/.test(imei)) return false;
  let total = 0;
  for (let i = 0; i < 15; i++) {
    const n = Number(imei[i]) * (i % 2 ? 2 : 1);
    total += n > 9 ? n - 9 : n;
  }
  return total % 10 === 0;
}
// How long a customer may wait in the queue when SKY is busy.
const QUEUE_LIMIT_MS = 60_000;
/** The server picks the prize, once per customer. When it is busy the
 *  customer waits in line (onQueue reports it) and the request is retried. */
export async function spinPrize(
  token: string,
  onQueue?: (waiting: boolean) => void,
) {
  const started = Date.now();
  for (;;) {
    try {
      const { reward } = await postJson<{ reward: string }>(
        "/customers/spin/",
        { token },
      );
      onQueue?.(false);
      return reward;
    } catch (e) {
      const err = e as ApiError;
      // Only a busy server queues. A rate limit (429), network errors and
      // timeouts stop at once with their message.
      const queued = err.status === 503;
      if (!queued || Date.now() - started > QUEUE_LIMIT_MS) {
        onQueue?.(false);
        throw err;
      }
      onQueue?.(true);
      const wait = Math.min(15, err.retryAfter || 5) * 1000;
      await new Promise((r) =>
        setTimeout(r, wait * (0.8 + Math.random() * 0.4)),
      );
    }
  }
}
type Upload = {
  session: string;
  phone?: string | null;
  mirror: string;
  reward?: string | null;
  poster: Blob;
  selfie?: Blob;
  branch?: string;
};
// Uploads wait in an on-device outbox until the backend confirms them, so a
// dropped connection, a down backend or a closed tab never loses a customer.
type Pending = Upload & { queuedAt: number };
const OUTBOX = "sky-upload-outbox",
  RETRY_MS = 30_000;
let outboxDb: Promise<IDBDatabase> | null = null;
function outbox() {
  if (!outboxDb)
    outboxDb = new Promise((resolve, reject) => {
      const req = indexedDB.open(OUTBOX, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("uploads");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return outboxDb;
}
async function outboxRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await outbox();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction("uploads", mode).objectStore("uploads"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const UPLOAD_TIMEOUT_MS = 60_000;
async function send(data: Upload) {
  const form = new FormData();
  form.append("session", data.session);
  form.append("mirror", data.mirror);
  if (data.phone) form.append("phone", data.phone);
  if (data.reward) form.append("reward", data.reward);
  if (data.branch) form.append("branch", data.branch);
  const ext = (b: Blob) => (b.type === "image/png" ? "png" : "jpg");
  form.append("poster", data.poster, `poster.${ext(data.poster)}`);
  if (data.selfie)
    form.append("selfie", data.selfie, `selfie.${ext(data.selfie)}`);
  // A request lost on a bad network gives up, so the outbox retries it.
  return fetch(`${API}/customers/`, { method: "POST", body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
}
// Removes an entry only if it wasn't replaced by a newer export meanwhile.
async function settle(sent: Pending) {
  const current = await outboxRequest<Pending | undefined>("readonly", (s) =>
    s.get(sent.session),
  );
  if (current?.queuedAt === sent.queuedAt)
    await outboxRequest("readwrite", (s) => s.delete(sent.session));
}
// What happened to this customer's poster upload, for an on-screen status line.
export type UploadState = "idle" | "saving" | "saved" | "retrying" | "failed";
let uploadState: UploadState = "idle";
const uploadListeners = new Set<() => void>();
function setUploadState(next: UploadState) {
  uploadState = next;
  uploadListeners.forEach((fn) => fn());
}
export const getUploadState = () => uploadState;
/** A new customer starts with no upload status. */
export const clearUploadState = () => setUploadState("idle");
export function subscribeUpload(fn: () => void) {
  uploadListeners.add(fn);
  return () => {
    uploadListeners.delete(fn);
  };
}
let flushing = false;
export async function flushUploads() {
  if (flushing) return;
  flushing = true;
  try {
    const pending = await outboxRequest<Pending[]>("readonly", (s) =>
      s.getAll(),
    );
    for (const item of pending) {
      let res: Response;
      try {
        res = await send(item);
      } catch {
        setUploadState("retrying"); // Offline or backend down: retry later.
        return;
      }
      // 4xx other than throttling means the upload itself is invalid; drop it
      // rather than retrying forever.
      const permanent =
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 408 &&
        res.status !== 429;
      if (res.ok) {
        const saved = (await res.json().catch(() => ({}))) as { poster?: string };
        if (saved.poster) posterUrl = absolute(MEDIA_ORIGIN + saved.poster);
      }
      if (res.ok || permanent) await settle(item);
      else {
        setUploadState("retrying");
        return;
      }
      if (permanent) setUploadState("failed");
    }
    if (uploadState !== "failed" && pending.length) setUploadState("saved");
  } catch {
    // IndexedDB unavailable; uploadCustomer already sent directly.
  } finally {
    flushing = false;
  }
}
export function startUploadSync() {
  void flushUploads();
  const timer = setInterval(() => void flushUploads(), RETRY_MS);
  const online = () => void flushUploads();
  window.addEventListener("online", online);
  return () => {
    clearInterval(timer);
    window.removeEventListener("online", online);
  };
}
// The server stores ≤200 KB photos anyway, so a PNG (3–5 MB) is re-encoded as
// JPEG on the phone first: uploads get ~10× smaller and finish sooner.
// The server keeps ≤200 KB; sending more only costs VPS bandwidth.
const UPLOAD_QUALITY = 0.72;
const POSTER_SIDE = 1280;
async function asJpeg(blob: Blob, maxSide = Infinity): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (blob.type === "image/jpeg" && scale === 1) {
      bitmap.close();
      return blob;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", UPLOAD_QUALITY),
    );
    return jpeg && jpeg.size < blob.size ? jpeg : blob;
  } catch {
    return blob;
  }
}

export async function uploadCustomer(data: Upload) {
  setUploadState("saving");
  data = {
    ...data,
    branch: data.branch ?? (BRANCH || undefined),
    poster: await asJpeg(data.poster, POSTER_SIDE),
    selfie: data.selfie && (await asJpeg(data.selfie)),
  };
  try {
    // Keyed by session: a re-export replaces that customer's queued upload.
    await outboxRequest("readwrite", (s) =>
      s.put({ ...data, queuedAt: Date.now() } satisfies Pending, data.session),
    );
  } catch {
    // No on-device storage (e.g. private mode): best-effort direct send.
    const res = await send(data).catch(() => null);
    setUploadState(res?.ok ? "saved" : "failed");
    return;
  }
  await flushUploads();
}
