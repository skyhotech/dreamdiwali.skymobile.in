export function instagramCaption(productCount: number, labels: string[] = []) {
  const purchase = productCount === 1 ? "my new purchase" : "my new purchases";
  const names = labels.map((s) => s.trim()).filter(Boolean);
  return `✨ Celebrating Diwali with SKY Mobile & Electronics! 🪔\n\nMy smile, ${purchase}, and a little Diwali magic.${names.length ? `\nMy SKY picks: ${names.join(", ")}.` : ""}\n\nThank you @skymobileandelectronics for making this festive season special!\n\n#DiwaliWithSKY #SKYMobile #SKYMobileElectronics #HappyDiwali #DiwaliShopping`;
}
export function copyCaption(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return Promise.resolve(false);
  try {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

export type ShareTarget = "instagram" | "facebook" | "whatsapp" | "more";
const FALLBACK: Record<ShareTarget, (text: string) => string | null> = {
  instagram: () => "https://www.instagram.com/",
  facebook: () => "https://www.facebook.com/",
  whatsapp: (text) => `https://wa.me/?text=${encodeURIComponent(text)}`,
  more: () => null,
};
/** Sends the poster and caption through the Web Share API. A website cannot
 *  pick the app itself, so the customer taps it in the share sheet. Must be
 *  called straight from a tap. Instagram and Facebook drop shared text, so
 *  the caption is always on the clipboard too. */
export async function sharePoster(
  target: ShareTarget,
  blob: Blob,
  name: string,
  text: string,
): Promise<"shared" | "cancelled" | "fallback"> {
  void copyCaption(text);
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file], text }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: "My SKY Diwali moment", text });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  const url = FALLBACK[target](text);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
  return "fallback";
}
