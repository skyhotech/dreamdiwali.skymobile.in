import { expect, test, type Page } from "@playwright/test";
// The customer's journey from the WhatsApp link, against a stubbed backend:
// terms → spin → iPhone offer → rating → mirror camera, and the ways back in.
type Link = Partial<{
  reward: string | null;
  next: string;
  video_review: boolean;
  poster: string | null;
}>;
async function openLink(page: Page, link: Link, posts: Record<string, unknown>[] = []) {
  await page.route("**/ai/**", (r) => r.abort());
  await page.route("**/api/live/", (r) => r.fulfill({ status: 204 }));
  await page.route("**/api/customers/link/**", (r) =>
    r.fulfill({
      json: {
        phone: "9787372973",
        name: "Asha",
        reward: null,
        items: [],
        poster: null,
        next: "terms",
        video_review: false,
        ...link,
      },
    }),
  );
  for (const step of ["terms", "spin", "review"])
    await page.route(`**/api/customers/${step}/`, (r) => {
      posts.push({ step, ...r.request().postDataJSON() });
      return r.fulfill({
        json: step === "spin" ? { reward: "power-bank" } : { next: "x" },
      });
    });
  // No voice in tests: the prize screen moves on as if speech had finished.
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { value: undefined });
  });
  await page.goto("/?spin=e2e-token");
  return posts;
}

test("the link opens on the terms, with the iPhone banner and Tamil", async ({ page }) => {
  await openLink(page, {});
  await expect(page.getByText("A chance to win an iPhone 15!")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Terms & Conditions" })).toBeVisible();
  await page.getByRole("button", { name: "தமிழில் படிக்க" }).click();
  await expect(page.getByRole("heading", { name: /விதிமுறைகள்/ })).toBeVisible();
  await page.getByRole("button", { name: "Read in English" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("the video pledge needs an Instagram ID, which is sent with the terms", async ({ page }) => {
  const posts = await openLink(page, {});
  await page.getByLabel("I accept the terms and conditions").check();
  await page.getByLabel("I will make a product video review").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Instagram ID" })).toBeVisible();
  await page.getByLabel("Your Instagram ID").fill("@asha.k");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Tap to spin" })).toBeVisible();
  expect(posts[0]).toMatchObject({ step: "terms", accept: true, video_review: true, instagram_id: "@asha.k" });
  // Already pledged: after the spin it goes straight to the rating.
  await page.getByRole("button", { name: "Tap to spin" }).click();
  await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible({ timeout: 15_000 });
});

test("after the spin: iPhone offer, Instagram ID, rating, then the mirror", async ({ page }) => {
  const posts = await openLink(page, { next: "spin" });
  await page.getByRole("button", { name: "Tap to spin" }).click();
  await expect(page.getByText("You won a Power Bank!")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: /really want to miss the chance/ }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "No, I want to win!" }).click();
  await page.getByLabel("Your Instagram ID").fill("asha.k");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Please choose a star rating.")).toBeVisible();
  await page.getByRole("radio", { name: "5 stars" }).click();
  await page.getByLabel("Your review").fill("Great service");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.locator(".camera-stage")).toBeVisible();
  expect(posts.map((p) => p.step)).toEqual(["spin", "terms", "review"]);
  expect(posts[2]).toMatchObject({ rating: 5, review: "Great service" });
});

test("skipping the iPhone chance goes straight to the rating", async ({ page }) => {
  await openLink(page, { next: "review", reward: "power-bank" });
  await page.getByRole("button", { name: "Yes, skip the chance" }).click();
  await expect(page.getByRole("heading", { name: "How was your visit?" })).toBeVisible();
});

test("a link that already spun goes to the mirror, never the wheel", async ({ page }) => {
  await openLink(page, { next: "mirror", reward: "power-bank", video_review: true });
  await expect(page.locator(".camera-stage")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tap to spin" })).toHaveCount(0);
});

test("a finished customer gets their poster back with share buttons", async ({ page }) => {
  await page.route("**/media/e2e-poster.jpg", (r) =>
    r.fulfill({ contentType: "image/jpeg", body: Buffer.from("ffd8ffd9", "hex") }),
  );
  await openLink(page, { next: "share", reward: "power-bank", poster: "/media/e2e-poster.jpg" });
  await expect(page.getByRole("heading", { name: "Your Diwali poster" })).toBeVisible();
  for (const name of ["Instagram", "Facebook", "WhatsApp", "More"])
    await expect(page.getByRole("button", { name })).toBeVisible();
});

test("an unknown link explains itself", async ({ page }) => {
  await page.route("**/api/customers/link/**", (r) =>
    r.fulfill({ status: 404, json: { detail: "This gift link isn't valid." } }),
  );
  await page.goto("/?spin=nope");
  await expect(page.getByText("This gift link isn't valid.")).toBeVisible();
});

test("sharing asks for the profile, opens the app and records the post link", async ({ page, context }) => {
  const events: Record<string, unknown>[] = [];
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/customers/event/", (r) => (events.push(r.request().postDataJSON()), r.fulfill({ json: { ok: true } })));
  await page.route("**/api/customers/profile/", (r) => (events.push({ profile: r.request().postDataJSON() }), r.fulfill({ json: { handle: "asha.k" } })));
  await page.route("**/media/e2e-poster.jpg", (r) => r.fulfill({ contentType: "image/jpeg", body: Buffer.from("ffd8ffd9", "hex") }));
  await page.addInitScript(() => {
    (navigator as { share?: unknown }).share = async () => {};
    (navigator as { canShare?: unknown }).canShare = () => true;
    window.open = () => null;
  });
  await openLink(page, { next: "share", reward: "power-bank", poster: "/media/e2e-poster.jpg" });
  await page.getByRole("button", { name: "Facebook" }).click();
  await page.getByLabel("Your Facebook profile link").fill("facebook.com/asha.k");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Link to your post").fill("https://www.facebook.com/asha.k/posts/1");
  await page.getByRole("button", { name: "Submit post link" }).click();
  await expect(page.getByText("Your post is recorded")).toBeVisible();
  // Shared elsewhere: WhatsApp Status is suggested next, and sends the image.
  await page.getByRole("button", { name: "Share on WhatsApp now" }).click();
  expect(events.map((e) => (e.kind as string) ?? "profile")).toEqual([
    "profile", "share_opened_facebook", "shared_facebook", "posted_facebook",
    "share_opened_whatsapp", "shared_whatsapp",
  ]);
});
