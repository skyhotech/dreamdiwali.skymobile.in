import skyLogo from "../assets/brand/sky.webp";
import { renderPoster, WIDTH, HEIGHT, type Composition } from "./renderer";
// Instagram-style post chrome added around the finished poster. The poster
// itself is drawn untouched between the header and footer bands.
export const PAGE_NAME = "skymobileandelectronics";
export const HEADER = 150,
  FOOTER = 330;
export const POST_HEIGHT = HEIGHT + HEADER + FOOTER;
const STATS = {
  likes: "1M",
  comments: "200K",
  reshares: "120K",
  shares: "100K",
};
const INK = "#0f0f0f",
  MUTED = "#737373",
  FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
// Lucide icon paths on a 24-unit grid; each subpath starts with an absolute M.
const ICONS = {
  heart:
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  comment: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z",
  repost:
    "M17 2l4 4-4 4 M3 11v-1a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v1a4 4 0 0 1-4 4H3",
  send: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z M21.854 2.147 10.914 13.086",
  bookmark: "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",
};
const logo = new Image();
const logoReady = new Promise<void>((resolve) => {
  logo.onload = logo.onerror = () => resolve();
});
logo.src = skyLogo;
/** Resolves once the profile logo can be drawn (or failed to load). */
export const instagramReady = () => logoReady;
function icon(
  ctx: CanvasRenderingContext2D,
  path: string,
  x: number,
  y: number,
  size: number,
  fill?: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  const p = new Path2D(path);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.strokeStyle = fill;
  } else ctx.strokeStyle = INK;
  ctx.stroke(p);
  ctx.restore();
}
function verified(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.fillStyle = "#0095f6";
  ctx.beginPath();
  // Scalloped badge: a 12-point star.
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI) / 12,
      r = i % 2 ? 15 : 17.5;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 0.5);
  ctx.lineTo(x - 2, y + 5.5);
  ctx.lineTo(x + 8, y - 5);
  ctx.stroke();
  ctx.restore();
}
function header(ctx: CanvasRenderingContext2D) {
  const cy = HEADER / 2,
    cx = 40 + 52;
  // Story ring.
  const ring = ctx.createLinearGradient(cx - 52, cy + 52, cx + 52, cy - 52);
  ring.addColorStop(0, "#feda75");
  ring.addColorStop(0.35, "#fa7e1e");
  ring.addColorStop(0.65, "#d62976");
  ring.addColorStop(1, "#962fbf");
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 42, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#fff";
  ctx.fillRect(cx - 42, cy - 42, 84, 84);
  if (logo.naturalWidth) ctx.drawImage(logo, cx - 42, cy - 42, 84, 84);
  ctx.restore();
  const tx = cx + 52 + 24;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(PAGE_NAME, tx, cy - 4);
  verified(ctx, tx + ctx.measureText(PAGE_NAME).width + 26, cy - 15);
  ctx.fillStyle = MUTED;
  ctx.font = `28px ${FONT}`;
  ctx.fillText("Diwali Celebration · Sponsored", tx, cy + 36);
  // "More" dots.
  ctx.fillStyle = INK;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(WIDTH - 52 - i * 16, cy, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
function footer(ctx: CanvasRenderingContext2D, top: number, caption: string) {
  const size = 58,
    y = top + 30;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `600 32px ${FONT}`;
  let x = 36;
  const actions: [string, string, string?][] = [
    [ICONS.heart, STATS.likes, "#ff3040"],
    [ICONS.comment, STATS.comments],
    [ICONS.repost, STATS.reshares],
    [ICONS.send, STATS.shares],
  ];
  for (const [path, label, fill] of actions) {
    icon(ctx, path, x, y, size, fill);
    x += size + 14;
    if (label) {
      ctx.fillStyle = INK;
      ctx.fillText(label, x, y + size / 2 + 2);
      x += ctx.measureText(label).width + 30;
    } else x += 26;
  }
  icon(ctx, ICONS.bookmark, WIDTH - 36 - size, y, size);
  let line = y + size + 52;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = `600 32px ${FONT}`;
  ctx.fillText(`${STATS.likes} likes`, 36, line);
  line += 50;
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(PAGE_NAME, 36, line);
  const nameW = ctx.measureText(PAGE_NAME + " ").width;
  ctx.font = `30px ${FONT}`;
  ctx.fillText(caption, 36 + nameW, line, WIDTH - 72 - nameW);
  line += 48;
  ctx.fillStyle = MUTED;
  ctx.fillText(
    `View all ${STATS.comments} comments · ${STATS.reshares} reshares · ${STATS.shares} shares`,
    36,
    line,
  );
  line += 44;
  ctx.font = `24px ${FONT}`;
  ctx.fillText("JUST NOW", 36, line);
}
/** Draws the poster wrapped as an Instagram post into a 1080 × POST_HEIGHT space. */
export function renderInstagramPost(
  ctx: CanvasRenderingContext2D,
  state: Composition,
  caption = "Celebrating Diwali with SKY ✨ #DiwaliWithSKY",
) {
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, WIDTH, POST_HEIGHT);
  header(ctx);
  ctx.translate(0, HEADER);
  // Keep the poster from drawing over the chrome bands.
  ctx.beginPath();
  ctx.rect(0, 0, WIDTH, HEIGHT);
  ctx.clip();
  renderPoster(ctx, state);
  ctx.restore();
  ctx.save();
  footer(ctx, HEADER + HEIGHT, caption);
  ctx.restore();
}
