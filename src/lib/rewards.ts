import neckband from "../assets/rewards/neckband.webp";
import miniSpeaker from "../assets/rewards/mini-speaker.webp";
import smartWatch from "../assets/rewards/smart-watch.webp";
import wiredHeadphone from "../assets/rewards/wired-headphone.webp";
import mobileStand from "../assets/rewards/mobile-stand.webp";
import powerBank from "../assets/rewards/power-bank.webp";
import { MEDIA_ORIGIN } from "./backend";
import spinSound from "../assets/rewards/spin.mp3";
import winSound from "../assets/rewards/win.mp3";
export type Reward = { id: string; label: string; image: string };
// Wheel order, clockwise from the top pointer.
export const REWARDS: Reward[] = [
  { id: "neckband", label: "Neck Band", image: neckband },
  { id: "mini-speaker", label: "Mini Speaker", image: miniSpeaker },
  { id: "smart-watch", label: "Smart Watch", image: smartWatch },
  { id: "wired-headphone", label: "Wired Headphone", image: wiredHeadphone },
  { id: "mobile-stand", label: "Mobile Stand", image: mobileStand },
  { id: "power-bank", label: "Power Bank", image: powerBank },
];
// Pictures for the gifts SKY started with; gifts added in the admin bring theirs.
const BUILT_IN = Object.fromEntries(REWARDS.map((r) => [r.id, r.image]));
let wheel = REWARDS;
/** This customer's gifts, chosen by the server from their bill value. */
export function setWheel(items: Reward[]) {
  if (!items.length) return;
  wheel = items.map((r) => ({
    ...r,
    image: r.image ? MEDIA_ORIGIN + r.image : (BUILT_IN[r.id] ?? ""),
  }));
}
export const wheelItems = () => wheel;
export const getReward = (id: string | null | undefined) =>
  wheel.find((r) => r.id === id) ?? REWARDS.find((r) => r.id === id) ?? null;
export const sounds = { spin: spinSound, win: winSound };
// Decoded images for the poster renderer; drawing starts once loaded.
const images = new Map<string, HTMLImageElement>();
export function rewardImage(reward: Reward) {
  let image = images.get(reward.id);
  if (!image) {
    image = new Image();
    // The poster canvas must stay exportable with gifts from the server.
    image.crossOrigin = "anonymous";
    image.src = reward.image;
    images.set(reward.id, image);
  }
  return image.complete && image.naturalWidth ? image : null;
}
let soundsLoaded = false;
export function preloadRewards() {
  wheel.forEach(rewardImage);
  if (!soundsLoaded) {
    soundsLoaded = true;
    for (const url of [spinSound, winSound]) void fetch(url).catch(() => {});
  }
}
