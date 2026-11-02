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
// Generous: the first customer on a phone also downloads the 6 MB model.
const TIMEOUT_MS = 20000;
/** Returns the fingerprint, or null if no face is found or models are missing. */
export async function faceFingerprint(
  image: HTMLImageElement | null | undefined,
): Promise<number[] | null> {
  if (!image) return null;
  const work = (async () => {
    const faceapi = await loadFaceModels();
    const result = await faceapi
      .detectSingleFace(
        image,
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
