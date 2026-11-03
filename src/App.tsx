import { lazy, Suspense, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Festive } from "./components/Festive";
import { OfflineBanner } from "./components/StatusNotices";
import { SPIN_TOKEN, fetchLink, spinPrize } from "./lib/backend";
import { preloadRewards, setWheel } from "./lib/rewards";
import { useStudio } from "./lib/store";
import { initializePhotoStorage } from "./lib/persistence";
// Managers and customers each download only their own screens.
const ManagerIntake = lazy(() =>
  import("./components/ManagerIntake").then((m) => ({ default: m.ManagerIntake })),
);
// Managers and customers each download only their own screens.
const SpinWheel = lazy(() =>
  import("./components/SpinWheel").then((m) => ({ default: m.SpinWheel })),
);
// Managers and customers each download only their own screens.
const SavedPoster = lazy(() =>
  import("./components/SavedPoster").then((m) => ({ default: m.SavedPoster })),
);
// Managers and customers each download only their own screens.
const ReviewForm = lazy(() =>
  import("./components/ReviewForm").then((m) => ({ default: m.ReviewForm })),
);
// Managers and customers each download only their own screens.
const TermsPage = lazy(() =>
  import("./components/TermsPage").then((m) => ({ default: m.TermsPage })),
);
// Managers and customers each download only their own screens.
const IphoneOffer = lazy(() =>
  import("./components/IphoneOffer").then((m) => ({ default: m.IphoneOffer })),
);
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
  const [poster, setPoster] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [offerDone, setOfferDone] = useState(false);
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
        setPoster(c.poster);
        setCustomerName(c.name);
        setReviewed(c.reviewed);
        setTermsAccepted(c.termsAccepted);
        setOfferDone(c.videoReview || c.reviewed);
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
            <Festive banner>
              <Suspense fallback={<div className="loading">Loading…</div>}>
                <div className="phone-card manager-note" role="status">
                  {linkError || "Opening your Diwali gift…"}
                </div>
              </Suspense>
            </Festive>
          ) : (
            <Suspense fallback={<div className="loading">Loading…</div>}>
              <ManagerIntake />
            </Suspense>
          )}
        </main>
      </MotionConfig>
    );
  // Finished before: back to their poster, ready to share again.
  if (poster)
    return (
      <MotionConfig reducedMotion="user">
        <main id="main" className="mobile-studio">
          <OfflineBanner />
          <Festive banner>
            <Suspense fallback={<div className="loading">Loading…</div>}>
              <SavedPoster url={poster} />
            </Suspense>
          </Festive>
        </main>
      </MotionConfig>
    );
  // The link opens on the terms; nothing else until they are accepted.
  if (!termsAccepted)
    return (
      <MotionConfig reducedMotion="user">
        <main id="main" className="mobile-studio">
          <OfflineBanner />
          <Festive banner>
            <Suspense fallback={<div className="loading">Loading…</div>}>
              <TermsPage token={token} onDone={() => setTermsAccepted(true)} />
            </Suspense>
          </Festive>
        </main>
      </MotionConfig>
    );
  // Spin first: the prize then goes on the mirror poster.
  if (!reward)
    return (
      <MotionConfig reducedMotion="user">
        <main id="main" className="mobile-studio">
          <OfflineBanner />
          <Festive banner>
            <Suspense fallback={<div className="loading">Loading…</div>}>
              <SpinWheel
                getPrize={({ onQueue }) => spinPrize(token, onQueue)}
                customerName={customerName}
                onClaim={(r) => useStudio.getState().setReward(r.id)}
              />
            </Suspense>
          </Festive>
        </main>
      </MotionConfig>
    );
  // Straight after the spin: one more invitation to the iPhone 15 contest.
  if (!offerDone)
    return (
      <MotionConfig reducedMotion="user">
        <main id="main" className="mobile-studio">
          <OfflineBanner />
          <Festive banner>
            <Suspense fallback={<div className="loading">Loading…</div>}>
              <IphoneOffer token={token} onDone={() => setOfferDone(true)} />
            </Suspense>
          </Festive>
        </main>
      </MotionConfig>
    );
  // After the spin: stars and a review, then the mirror selfie.
  if (!reviewed)
    return (
      <MotionConfig reducedMotion="user">
        <main id="main" className="mobile-studio">
          <OfflineBanner />
          <Festive banner>
            <Suspense fallback={<div className="loading">Loading…</div>}>
              <ReviewForm token={token} onDone={() => setReviewed(true)} />
            </Suspense>
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
