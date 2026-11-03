import { useEffect, useMemo, useRef, useState } from "react";
import { Gift, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { preloadRewards, sounds, wheelItems, type Reward } from "../lib/rewards";
// Few gifts repeat around the wheel, which still needs to look like one.
const MIN_SLICES = 6;
const NARROW = 10;
// Length of process spin.mp3; replaced by the real duration once it loads.
const FALLBACK_SPIN_MS = 2424;
// Full turns per spin.
const SPIN_TURNS = 2;
const BULBS = 16;
const CONFETTI = 36;
const COLORS = ["#d22856", "#d6a447", "#7a1631", "#f3cf7a"];
const CONFETTI_COLORS = ["#d22856", "#d6a447", "#f3cf7a", "#fff4dc", "#2b9f6b"];
const SIZE = 320,
  R = SIZE / 2;
function point(angle: number, radius: number) {
  const a = ((angle - 90) * Math.PI) / 180;
  return [R + radius * Math.cos(a), R + radius * Math.sin(a)];
}
function slicePath(i: number, slice: number) {
  const [x1, y1] = point(i * slice, R - 14);
  const [x2, y2] = point((i + 1) * slice, R - 14);
  return `M${R},${R} L${x1},${y1} A${R - 14},${R - 14} 0 0 1 ${x2},${y2} Z`;
}
// Time to enjoy the win (sound, confetti) before the prize is added automatically.
const AUTO_CLAIM_MS = 2200;
// Longest the wheel turns while waiting for the prize (the queue can extend it).
const MAX_WAIT_MS = 25_000;
// Starts at roughly the waiting speed, then a long smooth slow-down.
const LANDING_EASE = "cubic-bezier(0.33, 0.6, 0.3, 1)";
export function SpinWheel({
  onClaim,
  getPrize,
}: {
  onClaim: (reward: Reward) => void;
  /** Resolves the prize id; the server decides it, once per customer.
   *  onQueue(true) while the customer waits in line because SKY is busy. */
  getPrize: (progress: {
    onQueue: (waiting: boolean) => void;
  }) => Promise<string>;
}) {
  const [slices] = useState(() => {
    const items = wheelItems();
    const repeats = Math.ceil(MIN_SLICES / items.length);
    return Array.from({ length: repeats }, () => items).flat();
  });
  const SLICE = 360 / slices.length;
  // More gifts make thinner slices: the picture fits its slice, the text
  // shrinks, and past NARROW slices labels run along the slice instead.
  const picture = Math.min(28, Math.max(9, R * 0.58 * Math.sin(Math.PI / slices.length) - 3));
  const labelSize = Math.max(7, 12 - Math.max(0, slices.length - 8) * 0.5);
  const radial = slices.length > NARROW;
  const [rotation, setRotation] = useState(0);
  const [spinMs, setSpinMs] = useState(FALLBACK_SPIN_MS);
  const [ease, setEase] = useState(LANDING_EASE);
  const [phase, setPhase] = useState<"ready" | "spinning" | "won">("ready");
  const [won, setWon] = useState<Reward | null>(null);
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(false);
  const queuedRef = useRef(false);
  const onQueue = (waiting: boolean) => {
    queuedRef.current = waiting;
    setQueued(waiting);
  };
  const spinAudio = useRef<HTMLAudioElement | null>(null);
  const winAudio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef(0);
  const claimTimer = useRef(0);
  // Set synchronously, so a second tap or effect can never start another spin.
  const spinLock = useRef(false);
  useEffect(() => {
    preloadRewards();
    const spin = new Audio(sounds.spin);
    spin.preload = "auto";
    spinAudio.current = spin;
    const win = new Audio(sounds.win);
    win.preload = "auto";
    winAudio.current = win;
    // No refresh or leaving mid-spin (the server never re-rolls anyway).
    const block = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    addEventListener("beforeunload", block);
    document.documentElement.classList.add("no-pull-refresh");
    return () => {
      spin.pause();
      window.clearTimeout(timer.current);
      window.clearTimeout(claimTimer.current);
      removeEventListener("beforeunload", block);
      document.documentElement.classList.remove("no-pull-refresh");
    };
  }, []);
  // Random confetti paths, fixed per mount so re-renders don't reshuffle them.
  const confetti = useMemo(
    () =>
      Array.from({ length: CONFETTI }, (_, i) => {
        const angle = (i / CONFETTI) * Math.PI * 2 + Math.random() * 0.4;
        const distance = 120 + Math.random() * 110;
        return {
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance - 40,
          rotate: Math.random() * 720 - 360,
          delay: Math.random() * 0.15,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          round: i % 3 === 0,
        };
      }),
    [],
  );
  // The wheel turns from the tap (a CSS transition, smooth even when the phone
  // is busy) and the prize, once known, decides where its two turns end.
  async function spin() {
    if (spinLock.current) return;
    spinLock.current = true;
    setError("");
    setPhase("spinning");
    const audio = spinAudio.current;
    // Start the sound inside the tap; phones block audio started later.
    if (audio) {
      audio.currentTime = 0;
      audio.loop = false;
      void audio.play().catch(() => {});
    }
    // The wheel stops as the spin sound ends.
    const ms =
      audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.round(audio.duration * 1000)
        : FALLBACK_SPIN_MS;
    // Two full turns from here, easing out; the prize only adjusts where
    // they end, so the wheel never loops while waiting.
    const base = Math.ceil(rotation / 360) * 360;
    const started = performance.now();
    setSpinMs(ms);
    setEase(LANDING_EASE);
    setRotation(base + SPIN_TURNS * 360);
    let index: number;
    try {
      // Never spin for ever: give up after a while and offer Try again.
      let watchdog = 0;
      const since = performance.now();
      const prize = await Promise.race([
        getPrize({ onQueue }).finally(() => window.clearInterval(watchdog)),
        new Promise<never>((_, reject) => {
          // Waiting in the queue is fine; silence for too long is not.
          watchdog = window.setInterval(() => {
            if (!queuedRef.current && performance.now() - since > MAX_WAIT_MS) {
              window.clearInterval(watchdog);
              reject(new Error("SKY is taking too long. Tap Try again."));
            }
          }, 500);
        }),
      ]);
      const matching = slices.flatMap((r, i) => (r.id === prize ? [i] : []));
      if (!matching.length) throw new Error("Unknown prize. Try again.");
      index = matching[Math.floor(Math.random() * matching.length)];
    } catch (e) {
      audio?.pause();
      setError((e as Error).message);
      setPhase("ready");
      spinLock.current = false;
      return;
    }
    // Same two turns, ending with the middle of the prize slice under the
    // pointer. If the prize came late, this is one short final move.
    const landing = 360 - (index * SLICE + SLICE / 2);
    const target = base + SPIN_TURNS * 360 + landing;
    const remaining = Math.max(1200, ms - (performance.now() - started));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer.current);
      audio?.pause();
      if (winAudio.current) {
        winAudio.current.currentTime = 0;
        void winAudio.current.play().catch(() => {});
      }
      // A long celebratory buzz (Android; iPhones don't allow vibration).
      navigator.vibrate?.([220, 90, 220, 90, 900]);
      const reward = slices[index];
      setWon(reward);
      setPhase("won");
      claimTimer.current = window.setTimeout(
        () => onClaim(reward),
        AUTO_CLAIM_MS,
      );
    };
    // The transition restarts from the wheel's current angle: no jump.
    setSpinMs(remaining);
    setRotation(target);
    timer.current = window.setTimeout(finish, remaining + 100);
  }
  return (
    <div
      className="spin-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Spin the wheel"
    >
      <motion.div
        className={`spin-card spin-${phase}`}
        initial={{ scale: 0.6, opacity: 0, y: 40 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
      >
        <motion.h2
          key={phase === "won" ? "won" : "title"}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={
            phase === "won"
              ? {
                  scale: [0.5, 1.3, 0.92, 1.1, 1],
                  rotate: [0, -5, 4, -2, 0],
                  opacity: 1,
                }
              : { scale: 1, opacity: 1 }
          }
          transition={
            phase === "won"
              ? { duration: 0.9, ease: "easeOut" }
              : { type: "spring", stiffness: 400, damping: 14 }
          }
          className={phase === "won" ? "spin-title-won" : undefined}
        >
          {phase === "won" ? "Congratulations!" : "Spin & Win"}
        </motion.h2>
        <p role="status">
          {phase === "won" && won
            ? `You won a ${won.label}!`
            : phase === "spinning"
              ? queued
                ? "You're in the queue — SKY is busy, your spin is next…"
                : "Good luck…"
              : "Thanks for your purchase. Spin for a free gift!"}
        </p>
        <div className="spin-wheel-wrap">
          <div className="spin-glow" aria-hidden="true" />
          <div className="spin-pointer" aria-hidden="true" />
          {/* Idle sway lives on this wrapper: animating transform on the wheel
              itself makes the browser skip the spin transition entirely. */}
          <div className="spin-sway">
            {/* The turn is on a plain div: phones animate it on the GPU,
                so it keeps spinning even while the phone is busy. */}
            <div
              className="spin-wheel"
              style={{
                transform: `rotate(${rotation}deg)`,
                transitionDuration: `${spinMs}ms`,
                transitionTimingFunction: ease,
              }}
            >
              <svg
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className="spin-wheel-art"
                aria-hidden="true"
              >
                <defs>
                  {slices.map((r, i) => {
                    const [cx, cy] = point(i * SLICE + SLICE / 2, R * 0.58);
                    return (
                      <clipPath key={i} id={`spin-clip-${i}`}>
                        <circle cx={cx} cy={cy} r={picture} />
                      </clipPath>
                    );
                  })}
                  <radialGradient id="spin-hub" cx="40%" cy="35%">
                    <stop offset="0%" stopColor="#fff9f0" />
                    <stop offset="100%" stopColor="#d6a447" />
                  </radialGradient>
                </defs>
                <circle cx={R} cy={R} r={R - 1} fill="#5a1426" />
                {slices.map((r, i) => {
                  const mid = i * SLICE + SLICE / 2;
                  const [cx, cy] = point(mid, R * 0.58);
                  const [tx, ty] = point(mid, R * 0.83);
                  const light = i % 2 === 1;
                  return (
                    <g
                      key={i}
                      className={
                        phase === "won" && won?.id === r.id
                          ? "spin-slice-won"
                          : ""
                      }
                    >
                      <path
                        d={slicePath(i, SLICE)}
                        fill={COLORS[i % COLORS.length]}
                        stroke="#fff4dc"
                        strokeWidth={2}
                      />
                      <circle cx={cx} cy={cy} r={picture + 2} fill="#fff4dc" />
                      <image
                        href={r.image}
                        x={cx - picture}
                        y={cy - picture}
                        width={picture * 2}
                        height={picture * 2}
                        clipPath={`url(#spin-clip-${i})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                      <text
                        x={tx}
                        y={ty}
                        transform={`rotate(${radial ? mid - 90 : mid} ${tx} ${ty})`}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={light ? "#3c2418" : "#fff4dc"}
                        fontSize={labelSize}
                        fontWeight={700}
                      >
                        {r.label}
                      </text>
                    </g>
                  );
                })}
                {Array.from({ length: BULBS }, (_, i) => {
                  const [bx, by] = point((i * 360) / BULBS, R - 7);
                  return (
                    <circle
                      key={i}
                      cx={bx}
                      cy={by}
                      r={4}
                      className={`spin-bulb ${i % 2 ? "odd" : "even"}`}
                    />
                  );
                })}
                <circle
                  cx={R}
                  cy={R}
                  r={24}
                  fill="url(#spin-hub)"
                  stroke="#fff4dc"
                  strokeWidth={4}
                />
              </svg>
            </div>
          </div>
          <AnimatePresence>
            {phase === "won" && won && (
              <>
                <motion.div
                  className="spin-rays"
                  aria-hidden="true"
                  initial={{ scale: 0.3, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
                <motion.div
                  className="spin-burst"
                  aria-hidden="true"
                  initial={{ scale: 0.2, opacity: 0.9 }}
                  animate={{ scale: 2.4, opacity: 0 }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
                {[0, 0.7].flatMap((wave) =>
                  confetti.map((c, i) => (
                    <motion.span
                      key={`${wave}-${i}`}
                      className={`spin-confetti ${c.round ? "round" : ""}`}
                      style={{ background: c.color }}
                      aria-hidden="true"
                      initial={{
                        x: 0,
                        y: 0,
                        rotate: 0,
                        opacity: 1,
                        scale: 0.6,
                      }}
                      animate={{
                        x: c.x,
                        y: [0, c.y, c.y + 160],
                        rotate: c.rotate,
                        opacity: [1, 1, 0],
                        scale: 1,
                      }}
                      transition={{
                        duration: 1.6,
                        delay: c.delay + wave,
                        ease: "easeOut",
                      }}
                    />
                  )),
                )}
                <motion.img
                  className="spin-prize"
                  src={won.image}
                  alt={won.label}
                  initial={{ scale: 0, rotate: -180, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 220, damping: 13 }}
                />
              </>
            )}
          </AnimatePresence>
        </div>
        {phase === "won" && won ? (
          <motion.p
            className="spin-adding"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.35 }}
          >
            <Gift size={18} /> Adding your gift to the poster…
          </motion.p>
        ) : (
          phase === "ready" && (
            // One tap, one spin: the button is gone once the wheel starts.
            <button className="spin-button" onClick={() => void spin()}>
              <Sparkles size={20} />
              {error ? "Try again" : "Tap to spin"}
            </button>
          )
        )}
        {error && (
          <p className="spin-error" role="alert">
            {error}
          </p>
        )}
      </motion.div>
    </div>
  );
}
