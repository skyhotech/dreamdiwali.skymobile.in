import { lazy, Suspense, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { PhoneGate } from "./components/PhoneGate";
import { OfflineBanner } from "./components/StatusNotices";
import { registerPhone } from "./lib/backend";
import { preloadRewards } from "./lib/rewards";
import { useStudio } from "./lib/store";
import { initializePhotoStorage } from "./lib/persistence";
const CameraStudio = lazy(() => import("./components/CameraStudio"));
const Editor = lazy(() => import("./components/Editor"));
export default function App() {
  const step = useStudio((s) => s.step);
  const phone = useStudio((s) => s.phone);
  // Gift pictures and the spin sound start loading once the customer signs
  // in, so the wheel opens with everything already on the phone.
  useEffect(() => {
    if (phone) preloadRewards();
  }, [phone]);
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
