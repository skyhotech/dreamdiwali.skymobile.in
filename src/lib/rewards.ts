import neckband from "../assets/rewards/neckband.webp";
import miniSpeaker from "../assets/rewards/mini-speaker.webp";
import smartWatch from "../assets/rewards/smart-watch.webp";
import wiredHeadphone from "../assets/rewards/wired-headphone.webp";
import mobileStand from "../assets/rewards/mobile-stand.webp";
import powerBank from "../assets/rewards/power-bank.webp";
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
export const getReward = (id: string | null | undefined) =>
  REWARDS.find((r) => r.id === id) ?? null;
export const sounds = { spin: spinSound, win: winSound };
// Decoded images for the poster renderer; drawing starts once loaded.
const images = new Map<string, HTMLImageElement>();
export function rewardImage(reward: Reward) {
  let image = images.get(reward.id);
  if (!image) {
    image = new Image();
    image.src = reward.image;
    images.set(reward.id, image);
  }
  return image.complete && image.naturalWidth ? image : null;
}
let soundsLoaded = false;
export function preloadRewards() {
  REWARDS.forEach(rewardImage);
  if (!soundsLoaded) {
    soundsLoaded = true;
    for (const url of [spinSound, winSound]) void fetch(url).catch(() => {});
  }
}
