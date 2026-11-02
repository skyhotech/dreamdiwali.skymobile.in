import { useMemo, type ReactNode } from "react";
import { Fireworks } from "./Fireworks";
const PARTICLES = 18;
// The Diwali backdrop: crackers, floating diyas and sparkles.
export function Festive({ children }: { children: ReactNode }) {
  // Positions fixed per mount.
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
  return (
    <div className="phone-gate">
      {/* Decorations live in their own fixed, clipped layer so they never
          make the page scroll. */}
      <div className="phone-bg" aria-hidden="true">
        <div className="phone-glow" />
        <div className="phone-mandala" />
        <Fireworks />
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
      {children}
    </div>
  );
}
