// Face fingerprint for the repeat-customer check: 128 numbers from face-api,
// computed on this device. Only the numbers (never the model or a second photo)
// go to the backend, which compares them with earlier customers who consented.
type FaceApi = typeof import("@vladmandic/face-api");
let loading: Promise<FaceApi> | null = null;
export function loadFaceModels() {
  if (!loading)
    loading = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      const url = new URL(import.meta.env.BASE_URL + "ai/face", location.href)
        .href;
      // tf.ready() exists at runtime but is missing from face-api's typings.
      await (faceapi.tf as unknown as { ready(): Promise<void> }).ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(url),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url),
      ]);
      return faceapi;
    })().catch((error) => {
      loading = null; // allow a retry on the next spin
      throw error;
    });
  return loading;
}
// Generous: a low-end phone may still be downloading the 6 MB model.
const TIMEOUT_MS = 40000;
// The face is read from a copy this size: same fingerprint, far less work.
const READ_SIZE = 640;
/** Returns the fingerprint, or null if no face is found or models are missing. */
// One computation per selfie: the studio starts it right after the photo is
// taken, so it is usually ready before the customer taps Spin.
const fingerprints = new WeakMap<HTMLImageElement, Promise<number[] | null>>();
export function faceFingerprint(
  image: HTMLImageElement | null | undefined,
): Promise<number[] | null> {
  if (!image) return Promise.resolve(null);
  let pending = fingerprints.get(image);
  if (!pending) {
    pending = computeFingerprint(image);
    fingerprints.set(image, pending);
    // A failed or timed-out read is retried on the next request.
    void pending.then((f) => f || fingerprints.delete(image));
  }
  return pending;
}
async function computeFingerprint(
  image: HTMLImageElement,
): Promise<number[] | null> {
  const work = (async () => {
    const faceapi = await loadFaceModels();
    const scale = Math.min(
      1,
      READ_SIZE / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const small = document.createElement("canvas");
    small.width = Math.round(image.naturalWidth * scale);
    small.height = Math.round(image.naturalHeight * scale);
    small.getContext("2d")!.drawImage(image, 0, 0, small.width, small.height);
    const result = await faceapi
      .detectSingleFace(
        small,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5,
        }),
      )
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    return result
      ? Array.from(result.descriptor, (v) => Math.round(v * 1e5) / 1e5)
      : null;
  })();
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), TIMEOUT_MS),
  );
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  }
}
