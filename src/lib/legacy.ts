// Small fill-ins for older phone browsers, loaded before anything else.
if (!Object.hasOwn)
  Object.defineProperty(Object, "hasOwn", {
    value: (o: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(o, key),
    configurable: true,
    writable: true,
  });
if (!Array.prototype.at)
  Object.defineProperty(Array.prototype, "at", {
    value(this: unknown[], i: number) {
      const n = Math.trunc(i) || 0;
      return this[n < 0 ? this.length + n : n];
    },
    configurable: true,
    writable: true,
  });
// Rounded rectangles on a canvas: Chrome 99+ / Safari 16+ only. Without it
// the poster drawing stops halfway and customers see a black box.
type Radii = number | DOMPointInit | (number | DOMPointInit)[];
for (const Ctx of [
  typeof CanvasRenderingContext2D === "undefined" ? null : CanvasRenderingContext2D,
  typeof Path2D === "undefined" ? null : Path2D,
]) {
  if (!Ctx || "roundRect" in Ctx.prototype) continue;
  Object.defineProperty(Ctx.prototype, "roundRect", {
    value(this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii: Radii = 0) {
      const list = Array.isArray(radii) ? radii : [radii];
      const r = list.map((v) => (typeof v === "number" ? v : (v.x ?? 0)));
      const [tl, tr = tl, br = tl, bl = tr] = r.length ? r : [0];
      const fit = (v: number) => Math.max(0, Math.min(v, Math.abs(w) / 2, Math.abs(h) / 2));
      const [a, b, c, d] = [fit(tl), fit(tr), fit(br), fit(bl)];
      this.moveTo(x + a, y);
      this.arcTo(x + w, y, x + w, y + h, b);
      this.arcTo(x + w, y + h, x, y + h, c);
      this.arcTo(x, y + h, x, y, d);
      this.arcTo(x, y, x + w, y, a);
      this.closePath();
    },
    configurable: true,
    writable: true,
  });
}
// Request time limits: Chrome 103+ / Safari 16+ only. Without it every server
// request fails at once on older phones ("Can't reach SKY").
if (typeof AbortSignal !== "undefined" && !("timeout" in AbortSignal))
  Object.defineProperty(AbortSignal, "timeout", {
    value(ms: number) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    },
    configurable: true,
    writable: true,
  });
export {};
