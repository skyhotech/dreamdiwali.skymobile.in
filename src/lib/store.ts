import { create } from "zustand";
import {
  DEFAULT_TEMPLATE_ID,
  subscribeTemplates,
  templates,
} from "../templates";
import { clearUploadState, uploadCustomer } from "./backend";
export type Step =
  "welcome" | "selfie" | "selfieReview" | "product" | "edit" | "result";
export type Adjustment = { x: number; y: number; zoom: number };
export type Photo = {
  id: string;
  image: HTMLImageElement;
  blob: Blob;
  url: string;
  adjust: Adjustment;
  label: string;
};
export type Layout = "card" | "spotlight" | "gallery";
export const initialAdjustment = (): Adjustment => ({ x: 0, y: 0, zoom: 1 });
export const MAX_PRODUCTS = 5;
interface State {
  step: Step;
  template: string;
  /** Bumped when the backend replaces the theme list, to re-render. */
  catalog: number;
  selfie: Photo | null;
  products: Photo[];
  logo: Photo | null;
  layout: Layout;
  /** Spin-the-wheel prize id once claimed; shown on the poster. */
  reward: string | null;
  setReward: (id: string | null) => void;
  /** Signed-in customer's mobile number; one customer and one spin each. */
  phone: string | null;
  setPhone: (phone: string | null) => void;
  /** Instagram ID the customer gave, asked again before sharing. */
  instagramId: string;
  setInstagramId: (id: string) => void;
  /** Secret from the customer's WhatsApp link; it authorises their spin. */
  token: string | null;
  setToken: (token: string | null) => void;
  savedPoster: Blob | null;
  setSavedPoster: (poster: Blob | null) => void;
  setStep: (step: Step) => void;
  setTemplate: (id: string) => void;
  setSelfie: (p: Photo | null) => void;
  addProduct: (p: Photo) => void;
  removeProduct: (id: string) => void;
  updatePhoto: (id: string, a: Partial<Adjustment>) => void;
  setLabel: (id: string, label: string) => void;
  setLogo: (p: Photo | null) => void;
  setLayout: (l: Layout) => void;
  reset: () => void;
}
function release(p: Photo | null) {
  if (p) URL.revokeObjectURL(p.url);
}
// The phone lives in localStorage (not the photo draft) so the sign-in gate
// can be decided before photos are restored.
const PHONE_KEY = "sky-customer-phone";
const TOKEN_KEY = "sky-spin-token";
function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the link itself still carries the token.
  }
}
function readPhone() {
  try {
    return localStorage.getItem(PHONE_KEY);
  } catch {
    return null;
  }
}
function writePhone(phone: string | null) {
  try {
    if (phone) localStorage.setItem(PHONE_KEY, phone);
    else localStorage.removeItem(PHONE_KEY);
  } catch {
    // Storage blocked: the number lasts for this tab only.
  }
}
export const useStudio = create<State>((set, get) => ({
  step: "selfie",
  template: DEFAULT_TEMPLATE_ID,
  catalog: 0,
  selfie: null,
  products: [],
  logo: null,
  layout: "card",
  reward: null,
  setReward: (reward) => set({ reward, savedPoster: null }),
  phone: readPhone(),
  setPhone: (phone) => {
    writePhone(phone);
    set({ phone });
  },
  instagramId: "",
  setInstagramId: (instagramId) => set({ instagramId }),
  token: readToken(),
  setToken: (token) => {
    writeToken(token);
    set({ token });
  },
  savedPoster: null,
  setSavedPoster: (savedPoster) => {
    set({ savedPoster });
    const { selfie, template, reward, phone } = get();
    if (savedPoster && selfie)
      void uploadCustomer({
        session: selfie.id,
        phone,
        mirror: template,
        reward,
        poster: savedPoster,
      });
  },
  setStep: (step) => set({ step }),
  setTemplate: (template) => set({ template, savedPoster: null }),
  setSelfie: (p) => {
    release(get().selfie);
    set({ selfie: p, savedPoster: null });
  },
  addProduct: (p) => {
    if (get().products.length < MAX_PRODUCTS)
      set({ products: [...get().products, p], savedPoster: null });
    else release(p);
  },
  removeProduct: (id) => {
    release(get().products.find((p) => p.id === id) ?? null);
    set({
      products: get().products.filter((p) => p.id !== id),
      savedPoster: null,
    });
  },
  updatePhoto: (id, a) =>
    set((s) => ({
      savedPoster: null,
      selfie:
        s.selfie?.id === id
          ? { ...s.selfie, adjust: { ...s.selfie.adjust, ...a } }
          : s.selfie,
      products: s.products.map((p) =>
        p.id === id ? { ...p, adjust: { ...p.adjust, ...a } } : p,
      ),
    })),
  setLabel: (id, label) =>
    set((s) => ({
      savedPoster: null,
      products: s.products.map((p) =>
        p.id === id ? { ...p, label: label.slice(0, 36) } : p,
      ),
    })),
  setLogo: (p) => {
    release(get().logo);
    set({ logo: p });
  },
  setLayout: (layout) => set({ layout, savedPoster: null }),
  // Ends this customer's visit; the next person signs in with their number.
  reset: () => {
    release(get().selfie);
    get().products.forEach(release);
    writePhone(null);
    writeToken(null);
    clearUploadState();
    set({
      phone: null,
      token: null,
      selfie: null,
      products: [],
      savedPoster: null,
      reward: null,
      step: "selfie",
      layout: "card",
    });
  },
}));
subscribeTemplates(() =>
  useStudio.setState((s) => ({
    catalog: s.catalog + 1,
    // Fall back to the first theme if the selected one was removed or hidden.
    template: templates.some((t) => t.id === s.template)
      ? s.template
      : templates[0].id,
  })),
);
