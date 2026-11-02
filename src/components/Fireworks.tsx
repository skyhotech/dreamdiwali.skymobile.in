import { useEffect, useRef } from "react";
// Diwali crackers on one canvas: rockets that burst (peony, ring, willow,
// crackling glitter), anar fountains, chakri ground spinners and sparklers.
// One animation loop with a particle cap keeps it smooth on phones; it pauses
// when the tab is hidden and is skipped for reduced-motion users.
const COLORS = [
  "#d22856",
  "#f3cf7a",
  "#d6a447",
  "#ff7a1a",
  "#2b9f6b",
  "#3f7bff",
  "#b44cff",
  "#ff3b3b",
];
type Burst = "peony" | "ring" | "willow" | "crackle";
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  gravity: number;
  drag: number;
  kind: "spark" | "trail" | "glitter" | "rocket";
  burst?: Burst;
  /** Rockets burst on reaching this height. */
  top?: number;
};
const BURSTS: Burst[] = ["peony", "ring", "willow", "crackle"];
const pick = <T,>(list: readonly T[]) =>
  list[Math.floor(Math.random() * list.length)];

export function Fireworks() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d")!;
    const lowEnd =
      (navigator.hardwareConcurrency || 8) <= 4 ||
      ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
        8) <= 4;
    const MAX = lowEnd ? 260 : 520;
    const frameGap = lowEnd ? 1000 / 30 : 0;
    let w = 0,
      h = 0,
      raf = 0,
      last = 0,
      nextRocket = 0,
      nextGround = 0,
      spin = 0;
    const particles: Particle[] = [];
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, lowEnd ? 1.5 : 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener("resize", resize);
    const add = (p: Partial<Particle> & Pick<Particle, "x" | "y">) => {
      if (particles.length >= MAX) return;
      particles.push({
        vx: 0,
        vy: 0,
        life: 0,
        max: 60,
        color: pick(COLORS),
        size: 2,
        gravity: 0.04,
        drag: 0.985,
        kind: "spark",
        ...p,
      });
    };
    // The sign-in card fills the middle, so bursts go in the open sky above
    // it (and now and then low on the sides).
    const launch = () => {
      const low = Math.random() < 0.25;
      const top = low
        ? h * (0.78 + Math.random() * 0.08)
        : h * (0.06 + Math.random() * 0.1);
      add({
        x: low
          ? Math.random() < 0.5
            ? w * 0.15
            : w * 0.85
          : w * (0.15 + Math.random() * 0.7),
        y: h + 10,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -Math.sqrt(2 * 0.07 * (h - top)) * 1.25,
        max: 400,
        top,
        size: 2.4,
        gravity: 0.07,
        drag: 0.995,
        color: "#f3cf7a",
        kind: "rocket",
        burst: pick(BURSTS),
      });
    };
    const explode = (x: number, y: number, burst: Burst) => {
      const color = pick(COLORS),
        second = pick(COLORS),
        count = lowEnd ? 34 : 60;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const speed =
          burst === "ring"
            ? 4
            : 1.2 + Math.random() * (burst === "willow" ? 2.8 : 4);
        add({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          max: burst === "willow" ? 110 : 55 + Math.random() * 25,
          color: burst === "willow" ? "#d6a447" : i % 3 ? color : second,
          size: burst === "ring" ? 3.2 : 2.8,
          gravity: burst === "willow" ? 0.03 : 0.045,
          drag: burst === "willow" ? 0.975 : 0.965,
          kind:
            burst === "willow"
              ? "trail"
              : burst === "crackle"
                ? "glitter"
                : "spark",
        });
      }
      // Bright flash at the centre of every burst.
      add({ x, y, max: 10, size: 16, gravity: 0, color: "#fff9f0" });
    };
    const ground = () => {
      // Anar (flower pot) fountains near the bottom corners.
      for (const fx of [w * 0.1, w * 0.9])
        for (let i = 0; i < (lowEnd ? 2 : 4); i++)
          add({
            x: fx,
            y: h - 6,
            vx: (Math.random() - 0.5) * 2.2,
            vy: -(3 + Math.random() * 3.2),
            max: 45 + Math.random() * 20,
            color: pick(["#f3cf7a", "#ff7a1a", "#fff4dc", "#d6a447"]),
            size: 1.6,
            gravity: 0.09,
            kind: "glitter",
          });
      // Chakri: a spinning ground wheel throwing sparks around.
      spin += 0.45;
      const cx = w * 0.5,
        cy = h - 18;
      for (let i = 0; i < (lowEnd ? 2 : 3); i++) {
        const a = spin + (i * Math.PI * 2) / 3;
        add({
          x: cx + Math.cos(a) * 8,
          y: cy + Math.sin(a) * 8,
          vx: Math.cos(a + Math.PI / 2) * 3.2,
          vy: Math.sin(a + Math.PI / 2) * 3.2 - 0.4,
          max: 24,
          color: pick(["#f3cf7a", "#2b9f6b", "#ff3b3b", "#fff4dc"]),
          size: 1.6,
          gravity: 0.05,
          drag: 0.94,
        });
      }
      // Sparkler sparks fizzing at the top corners.
      add({
        x: Math.random() < 0.5 ? w * 0.04 : w * 0.96,
        y: h * 0.22,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        max: 22,
        color: "#fff4dc",
        size: 1.3,
        gravity: 0.02,
        kind: "glitter",
      });
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || now - last < frameGap) return;
      last = now;
      if (now > nextRocket) {
        launch();
        nextRocket = now + (lowEnd ? 900 : 550) + Math.random() * 700;
      }
      if (now > nextGround) {
        ground();
        nextGround = now + (lowEnd ? 70 : 45);
      }
      // Fade the previous frame instead of clearing it: every spark gets a tail.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        if (p.kind === "rocket" && (p.y <= (p.top ?? 0) || p.vy > -1)) {
          explode(p.x, p.y, p.burst ?? "peony");
          particles.splice(i, 1);
          continue;
        }
        if (p.life >= p.max || p.y > h + 20) {
          particles.splice(i, 1);
          continue;
        }
        // Glitter twinkles; willow trails linger.
        if (p.kind === "glitter" && Math.random() < 0.35) continue;
        const fade = 1 - p.life / p.max;
        // Bold on the light background: stay nearly opaque until the end.
        ctx.globalAlpha = Math.min(1, fade * 1.6);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + fade * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="phone-fireworks" aria-hidden="true" />;
}
