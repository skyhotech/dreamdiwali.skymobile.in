import { lazy, Suspense, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { PhoneGate } from "./components/PhoneGate";
import { OfflineBanner } from "./components/StatusNotices";
import { registerPhone } from "./lib/backend";
import { faceFingerprint, loadFaceModels } from "./lib/faceMatch";
import { useStudio } from "./lib/store";
import { initializePhotoStorage } from "./lib/persistence";
const CameraStudio = lazy(() => import("./components/CameraStudio"));
const Editor = lazy(() => import("./components/Editor"));
export default function App() {
  const step = useStudio((s) => s.step);
  const phone = useStudio((s) => s.phone);
  const [hydrated, setHydrated] = useState(false);
  // On start, re-check a number remembered from an earlier visit against the
  // database, so a prize already won (on any device) is restored rather than
  // re-spun. Fresh sign-ins are checked by PhoneGate itself.
  useEffect(() => {
    const remembered = useStudio.getState().phone;
    if (!remembered) return;
    registerPhone(remembered)
      .then((c) => {
        if (c.reward && !useStudio.getState().reward)
          useStudio.getState().setReward(c.reward);
      })
      .catch(() => {});
  }, []);
  // Read the face (≈8 MB of models, needed at the spin) as soon as the selfie
  // is taken, so it never competes with the first screen and is usually
  // ready before the customer taps Spin.
  const selfieImage = useStudio((s) => s.selfie?.image);
  useEffect(() => {
    if (phone && selfieImage) void faceFingerprint(selfieImage);
  }, [phone, selfieImage]);
  // Start fetching the face models once signed in (after the camera has had
  // a moment to start), so they're ready by the time the selfie is taken.
  useEffect(() => {
    if (!phone) return;
    const id = window.setTimeout(
      () => void loadFaceModels().catch(() => {}),
      2500,
    );
    return () => window.clearTimeout(id);
  }, [phone]);
  useEffect(() => {
    let active = true;
    void initializePhotoStorage().then(() => {
      if (active) setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!hydrated)
    return <div className="loading">Opening your saved studio…</div>;
  if (!phone)
    return (
      <MotionConfig reducedMotion="user">
        <main id="main" className="mobile-studio">
          <OfflineBanner />
          <PhoneGate />
        </main>
      </MotionConfig>
    );
  return (
    <MotionConfig reducedMotion="user">
      <main id="main" className="mobile-studio">
        <OfflineBanner />
        <Suspense fallback={<div className="loading">Opening camera…</div>}>
          {["selfie", "selfieReview", "product"].includes(step) ? (
            <CameraStudio key={step === "product" ? "product" : "selfie"} />
          ) : (
            <Editor />
          )}
        </Suspense>
      </main>
    </MotionConfig>
  );
}
