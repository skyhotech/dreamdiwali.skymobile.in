import { useMemo, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import skyLogo from "../assets/brand/sky.webp";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { PHONE_PATTERN, registerPhone } from "../lib/backend";
import { useStudio } from "../lib/store";
const PARTICLES = 18;
const item = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
} as const;
// First screen for every customer: one mobile number = one customer and one
// spin, checked against the backend.
export function PhoneGate() {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const shake = useAnimationControls();
  const valid = PHONE_PATTERN.test(phone);
  const fake = phone.length === 10 && !valid;
  // Floating diyas and sparkles; positions fixed per mount.
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => ({
        left: `${(i * 97) % 100}%`,
        size: 6 + ((i * 7) % 10),
        delay: (i * 0.73) % 6,
        duration: 7 + ((i * 3) % 6),
        diya: i % 4 === 0,
      })),
    [],
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!valid) {
      setError("Enter a valid 10-digit mobile number.");
      void shake.start({
        x: [0, -10, 10, -7, 7, -3, 0],
        transition: { duration: 0.45 },
      });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const customer = await registerPhone(phone);
      setDone(true);
      // Let the success tick play before the studio opens.
      await new Promise((r) => setTimeout(r, 650));
      const s = useStudio.getState();
      if (customer.reward) s.setReward(customer.reward);
      s.setPhone(customer.phone);
    } catch (err) {
      setError((err as Error).message);
      void shake.start({
        x: [0, -10, 10, -7, 7, -3, 0],
        transition: { duration: 0.45 },
      });
      setBusy(false);
    }
  }
  return (
    <div className="phone-gate">
      {/* Decorations live in their own fixed, clipped layer so they never
          make the page scroll. */}
      <div className="phone-bg" aria-hidden="true">
        <div className="phone-glow" />
        <div className="phone-mandala" />
        {particles.map((p, i) => (
          <span
            key={i}
            className={`phone-particle ${p.diya ? "phone-diya" : "phone-spark"}`}
            style={{
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: `-${p.delay}s`,
              animationDuration: `${p.duration}s`,
            }}
          />
        ))}
      </div>
      <motion.div animate={shake} className="phone-shake">
        <motion.form
          className="phone-card"
          onSubmit={(e) => void submit(e)}
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0, scale: 0.92, y: 30 },
            show: {
              opacity: 1,
              scale: 1,
              y: 0,
              transition: {
                type: "spring",
                stiffness: 240,
                damping: 22,
                staggerChildren: 0.07,
                delayChildren: 0.15,
              },
            },
          }}
          noValidate
        >
          <motion.div className="phone-logo" variants={item}>
            <img src={skyLogo} alt="SKY Mobile & Electronics" />
            <AnimatePresence>
              {done && (
                <motion.span
                  className="phone-logo-ok"
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  aria-hidden="true"
                >
                  <Check size={18} />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
          <motion.h1 variants={item} className="phone-title">
            Celebrate Diwali with SKY
          </motion.h1>
          <motion.p variants={item}>
            Enter your mobile number to take your selfie and spin for a gift.
          </motion.p>
          <motion.label variants={item} htmlFor="customer-phone">
            Mobile number
          </motion.label>
          <motion.div variants={item} className="phone-field">
            <span>+91</span>
            <input
              id="customer-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98765 43210"
              maxLength={10}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                setError("");
              }}
              aria-invalid={fake}
              aria-describedby="phone-help"
              autoFocus
            />
            <AnimatePresence>
              {valid && (
                <motion.span
                  className="phone-valid"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  aria-hidden="true"
                >
                  <Check size={18} />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
          <motion.p
            variants={item}
            id="phone-help"
            className={`phone-help${error || fake ? " phone-help-error" : ""}`}
            role="alert"
          >
            {error ||
              (fake
                ? "Enter a valid 10-digit mobile number."
                : "One gift per mobile number.")}
          </motion.p>
          <motion.button
            variants={item}
            className="spin-button phone-continue"
            type="submit"
            disabled={!valid || busy}
            whileTap={{ scale: 0.96 }}
          >
            {done ? "Welcome!" : busy ? "Checking…" : "Proceed"}
          </motion.button>
          <motion.p variants={item} className="phone-notice">
            <ShieldCheck size={13} aria-hidden="true" /> By tapping Proceed you
            agree to a selfie &amp; face check — one gift per person.
          </motion.p>
        </motion.form>
      </motion.div>
    </div>
  );
}
