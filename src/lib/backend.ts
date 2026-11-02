import { replaceTemplates, type Template } from "../templates";

// Same-origin by default (Vite proxies /api in dev); set VITE_API_URL otherwise.
// The Vercel-hosted studio talks to the VPS API (a public URL, not a secret).
const VPS_API = "https://222.167.207.123";
const onVercel =
  typeof location !== "undefined" && location.hostname.endsWith(".vercel.app");
/** Backend origin; empty when the studio and API share one site. */
export const API_ORIGIN = (
  import.meta.env.VITE_API_URL ?? (onVercel ? VPS_API : "")
).replace(
  /\/$/,
  "",
);
const API = API_ORIGIN + "/api";
/** Where /media files load from. On Vercel they go through its CDN (see
 *  vercel.json), so each image leaves the VPS once and loads from nearby. */
export const MEDIA_ORIGIN = onVercel && !import.meta.env.VITE_API_URL ? "" : API_ORIGIN;
// Fallback when the event stream is unavailable (e.g. a proxy that buffers it).
export const POLL_MS = 1000;

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
  if (typeof EventSource !== "undefined") {
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
  ) {
    super(message);
  }
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!navigator.onLine) throw new ApiError(ERRORS.offline);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After")) || 30;
      throw new ApiError(ERRORS.busy(Math.ceil(wait)), 429);
    }
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
/** Signs the customer in by mobile number; returns their prize if already spun. */
export const registerPhone = (phone: string) =>
  postJson<{ phone: string; reward: string | null }>("/customers/register/", {
    phone,
    // The sign-in screen only submits after the consent box is ticked.
    consent: true,
  });
/** The server picks the prize, once per mobile number. */
export const spinPrize = async (phone: string, face: number[] | null) =>
  (await postJson<{ reward: string }>("/customers/spin/", { phone, face }))
    .reward;
type Upload = {
  session: string;
  phone?: string | null;
  mirror: string;
  reward?: string | null;
  poster: Blob;
  selfie?: Blob;
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
async function send(data: Upload) {
  const form = new FormData();
  form.append("session", data.session);
  form.append("mirror", data.mirror);
  if (data.phone) form.append("phone", data.phone);
  if (data.reward) form.append("reward", data.reward);
  const ext = (b: Blob) => (b.type === "image/png" ? "png" : "jpg");
  form.append("poster", data.poster, `poster.${ext(data.poster)}`);
  if (data.selfie)
    form.append("selfie", data.selfie, `selfie.${ext(data.selfie)}`);
  return fetch(`${API}/customers/`, { method: "POST", body: form });
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
async function asJpeg(blob: Blob): Promise<Blob> {
  if (blob.type === "image/jpeg") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
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
    poster: await asJpeg(data.poster),
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
