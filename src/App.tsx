import { lazy, Suspense, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Festive } from "./components/Festive";
import { ManagerIntake } from "./components/ManagerIntake";
import { SpinWheel } from "./components/SpinWheel";
import { OfflineBanner } from "./components/StatusNotices";
import { SPIN_TOKEN, fetchLink, spinPrize } from "./lib/backend";
import { preloadRewards, setWheel } from "./lib/rewards";
import { useStudio } from "./lib/store";
import { initializePhotoStorage } from "./lib/persistence";
const CameraStudio = lazy(() => import("./components/CameraStudio"));
const Editor = lazy(() => import("./components/Editor"));
export default function App() {
  return (
    <>
      <Studio />
      <SpeedInsights />
    </>
  );
}
function Studio() {
  const step = useStudio((s) => s.step);
  const phone = useStudio((s) => s.phone);
  const token = useStudio((s) => s.token);
  const reward = useStudio((s) => s.reward);
  const [linkError, setLinkError] = useState("");
  const [linkReady, setLinkReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Gift pictures and the spin sound start loading once the customer signs
  // in, so the wheel opens with everything already on the phone.
  useEffect(() => {
    if (phone) preloadRewards();
  }, [phone]);
  // A WhatsApp link decides who this is; the server remembers their prize, so
  // reopening the link (on any device) continues rather than re-spins.
  useEffect(() => {
    if (!SPIN_TOKEN || !hydrated) return;
    let live = true;
    fetchLink(SPIN_TOKEN)
      .then((c) => {
        if (!live) return;
        const s = useStudio.getState();
        // A different link on this phone: nothing of the last customer stays.
        if (s.token && s.token !== SPIN_TOKEN) s.reset();
        setWheel(c.items);
        s.setReward(c.reward);
        s.setToken(SPIN_TOKEN);
        s.setPhone(c.phone);
        setLinkReady(true);
      })
      .catch((e: Error) => live && setLinkError(e.message));
    return () => {
      live = false;
    };
  }, [phone, hydrated]);

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
  // Only the link itself opens a customer; the main page is always the form.
  const signedIn = phone && token && token === SPIN_TOKEN && linkReady;
  if (!signedIn)
    return (
      <MotionConfig reducedMotion="user">
        <main id="main" className="mobile-studio">
          <OfflineBanner />
          {SPIN_TOKEN ? (
            <Festive>
              <div className="phone-card manager-note" role="status">
                {linkError || "Opening your Diwali gift…"}
              </div>
            </Festive>
          ) : (
            <ManagerIntake />
          )}
        </main>
      </MotionConfig>
    );
  // Spin first: the prize then goes on the mirror poster.
  if (!reward)
    return (
      <MotionConfig reducedMotion="user">
        <main id="main" className="mobile-studio">
          <OfflineBanner />
          <Festive>
            <SpinWheel
              getPrize={({ onQueue }) => spinPrize(token, onQueue)}
              onClaim={(r) => useStudio.getState().setReward(r.id)}
            />
          </Festive>
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
