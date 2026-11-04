import { test, expect, type Page } from "@playwright/test";
// Never write test customers into the real backend: stub the upload endpoint.
// Individual tests can override this with their own page.route().
// The customer's link says they are past terms, spin, offer and rating, so
// these tests start at the mirror camera.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/customers/", (route) =>
    route.fulfill({ status: 201, json: { id: 0 } }),
  );
  await page.route("**/api/customers/spin/", (route) =>
    route.fulfill({ json: { reward: "smart-watch" } }),
  );
  await page.route("**/api/customers/link/**", (route) =>
    route.fulfill({
      json: {
        phone: "9845012345",
        name: "Asha",
        reward: "power-bank",
        items: [],
        poster: null,
        next: "mirror",
        video_review: true,
      },
    }),
  );
  await page.addInitScript(() =>
    (localStorage.setItem("sky-customer-phone", "9845012345"),
    localStorage.setItem("sky-spin-token", "test-token")),
  );
});
/** Which photos the studio has saved on the device for this visit. */
function savedDraft(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("sky-private-photos", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const draft = await new Promise<{ selfie?: unknown } | undefined>((resolve) => {
      const r = db.transaction("drafts").objectStore("drafts").get("latest-draft");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    });
    db.close();
    return { selfie: Boolean(draft?.selfie) };
  });
}
async function mockCamera(
  page: Page,
  rearUnavailable = false,
  withAi = false,
  blank = false,
) {
  if (!withAi) {
    await page.route("**/ai/**", (r) => r.abort());
    // Where the face model loads anyway (CI downloads it), the fake camera
    // shows no face: skip the face check, and keep auto capture idle.
    await page.addInitScript(() => {
      (window as { skyFakeCue?: unknown }).skyFakeCue = { smile: 0, gesture: "" };
    });
  }
  await page.addInitScript(
    ({ rearUnavailable }) => {
      const calls: string[] = [],
        stops: string[] = [];
      Object.assign(window, { cameraCalls: calls, cameraStops: stops });
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          Object.assign(window, {
            defaultSkyShare: { text: data.text, files: data.files?.length },
          });
        },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => {} },
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async (constraints: MediaStreamConstraints) => {
          const video = constraints.video as MediaTrackConstraints;
          const exact =
            typeof video.facingMode === "object"
              ? (video.facingMode as ConstrainDOMStringParameters).exact
              : undefined;
          const facing = exact === "environment" ? "environment" : "user";
          calls.push(JSON.stringify(constraints));
          if (rearUnavailable && facing === "environment")
            throw new DOMException("No rear camera", "OverconstrainedError");
          const c = document.createElement("canvas");
          c.width = 640;
          c.height = 480;
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = facing === "user" ? "#788e85" : "#9d6354";
          ctx.fillRect(0, 0, 640, 480);
          // Some detail in a corner, so it isn't one flat colour (= blank).
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = k % 2 ? "#ffffff" : "#111111";
            ctx.fillRect(k * 40, 0, 40, 120);
          }
          const stream = c.captureStream(10),
            track = stream.getVideoTracks()[0],
            stop = track.stop.bind(track);
          track.stop = () => {
            stops.push(facing);
            stop();
          };
          track.getSettings = () => ({ facingMode: facing });
          return stream;
        },
      });
    },
    { rearUnavailable },
  );
  if (blank)
    await page.addInitScript(() => {
      // A covered lens: every frame black.
      const real = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
        if (this.canvas.width === 640) {
          this.fillStyle = "#000";
          return real.call(this, 0, 0, 640, 480);
        }
        return real.call(this, x, y, w, h);
      };
      CanvasRenderingContext2D.prototype.arc = function () {};
    });
}
async function takeSelfie(page: Page) {
  await page.goto("/?spin=test-token");
  await expect(
    page
      .locator(".camera-stage")
      .getByRole("button", { name: "Post on Instagram", exact: true }),
  ).toBeEnabled({ timeout: 15_000 });
  await page
    .getByRole("button", { name: "Post on Instagram", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 15_000 });
}
// The prize wheel opens after the first product photo, spins by itself and
// the prize is added to the poster automatically.
// The wheel now comes before the camera; these tests start with a prize won.
// After the product photo the guided share window opens: these camera tests
// close it to reach the poster (the window has its own test).
async function spinAndClaim(page: import("@playwright/test").Page) {
  await expect(page.locator(".share-page")).toBeVisible({ timeout: 15_000 });
}
// From the finished poster to the share page's three buttons.
async function openSharePage(page: import("@playwright/test").Page) {
  await page.route("**/api/customers/profile/", (r) => r.fulfill({ json: { handle: "asha.k" } }));
  await page.route("**/api/customers/event/", (r) => r.fulfill({ json: { ok: true } }));
  await page.context().route(/https:\/\/(www\.instagram\.com|wa\.me)\//, (r) =>
    r.fulfill({ contentType: "text/html", body: "<title>app</title>" }),
  );
  await spinAndClaim(page);
  await page.getByRole("textbox", { name: "Instagram ID" }).fill("@asha.k");
  await page.getByRole("button", { name: "Continue to sharing" }).click();
  await expect(page.getByRole("heading", { name: "Step 1: Share your poster" })).toBeVisible();
}
test("rear camera appears in the small product box, then captures and shares", async ({
  page,
}) => {
  await mockCamera(page);
  await takeSelfie(page);
  await expect(page.locator(".camera-stage canvas")).toHaveAttribute(
    "aria-label",
    /with your selfie/,
  );
  await expect(page.locator("video.product-video")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".camera-stage canvas")
        .evaluate((c) =>
          Array.from(
            (c as HTMLCanvasElement)
              .getContext("2d")!
              .getImageData(270, 670 + 75, 1, 1).data,
          ).slice(0, 3),
        ),
    )
    .toEqual([157, 99, 84]);
  const camera = await page.evaluate(() => ({
    calls: (window as unknown as { cameraCalls: string[] }).cameraCalls,
    stops: (window as unknown as { cameraStops: string[] }).cameraStops,
  }));
  expect(camera.calls.some((c) => c.includes('"exact":"environment"'))).toBe(
    true,
  );
  expect(camera.stops).toContain("user");
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await openSharePage(page);
  // The mirror and selfie are gone: only the share page remains.
  await expect(page.locator(".camera-stage")).toHaveCount(0);
  const card = page.locator("#share-instagram");
  await expect(card.getByLabel("Link to your Instagram post")).toHaveCount(0);
  // Instagram opens straight away, with the poster saved to the phone.
  const dl = page.waitForEvent("download"),
    popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Share on Instagram" }).click();
  expect((await dl).suggestedFilename()).toMatch(/^SKY-Diwali-.+\.jpg$/);
  await expect(await popup).toHaveURL("https://www.instagram.com/");
  // Then the proof field for Instagram.
  await expect(card.getByLabel("Link to your Instagram post")).toBeVisible();
});
test("product camera automatically falls back to front camera", async ({
  page,
}) => {
  await mockCamera(page, true);
  await takeSelfie(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Using the front camera" }),
  ).toBeVisible();
  const calls = await page.evaluate(
    () => (window as unknown as { cameraCalls: string[] }).cameraCalls,
  );
  const rear = calls.findIndex((c) => c.includes('"exact":"environment"'));
  expect(rear).toBeGreaterThanOrEqual(0);
  expect(calls.slice(rear + 1).some((c) => c.includes('"ideal":"user"'))).toBe(
    true,
  );
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await spinAndClaim(page);
});
test("the flip button swaps between front and back camera", async ({ page }) => {
  await mockCamera(page);
  await page.goto("/?spin=test-token");
  const flip = page.getByRole("button", { name: "Switch to back camera" });
  await expect(page.getByRole("button", { name: "Post on Instagram", exact: true })).toBeEnabled();
  await flip.click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { cameraCalls: string[] }).cameraCalls.at(-1))).toContain('"exact":"environment"');
  await page.getByRole("button", { name: "Switch to front camera" }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { cameraCalls: string[] }).cameraCalls.at(-1))).toContain('"ideal":"user"');
  await expect(page.getByRole("button", { name: /Pause camera|Resume camera/ })).toHaveCount(0);
});
test("filter controls and uploads are absent", async ({
  page,
}) => {
  await mockCamera(page);
  await page.goto("/?spin=test-token");
  await expect(
    page.getByRole("button", {
      name: "Post on Instagram",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", {
      name: /Smile filter|Smile to capture|Upload photo/,
    }),
  ).toHaveCount(0);
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await expect(
    page.getByRole("slider", { name: "Expression intensity" }),
  ).toHaveCount(0);
});
test("a blank or covered-camera selfie is refused", async ({ page }) => {
  await mockCamera(page, false, false, true);
  await page.goto("/?spin=test-token");
  const shutter = page
    .locator(".camera-stage")
    .getByRole("button", { name: "Post on Instagram", exact: true });
  await expect(shutter).toBeEnabled();
  await shutter.click();
  await expect(
    page.getByRole("status").filter({ hasText: /looks blank/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    }),
  ).toHaveCount(0);
});
test("permission denial offers retry without upload suggestions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { cameraAsks: 0 });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        (window as unknown as { cameraAsks: number }).cameraAsks++;
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  await page.goto("/?spin=test-token");
  await expect(page.getByText(/Camera permission was denied/)).toBeVisible();
  // Refused: the website's steps, or on iPhone (permission lives in
  // Settings → Safari) the phone's.
  await expect(
    page.getByRole("alertdialog", {
      name: /Allow the camera for this website|Turn on the camera in your phone settings/,
    }),
  ).toBeVisible();
  // The studio keeps asking for the camera by itself.
  const asks = () =>
    page.evaluate(
      () => (window as unknown as { cameraAsks: number }).cameraAsks,
    );
  const first = await asks();
  await expect.poll(asks, { timeout: 12_000 }).toBeGreaterThan(first + 1);
  await expect(
    page.getByRole("button", { name: "Retry camera" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Post on Instagram",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByText(/upload a photo|Flip camera/i)).toHaveCount(0);
});
test("both bundled original frames load without any upload prompt", async ({
  page,
}) => {
  await page.goto("/?spin=test-token");
  for (const [name, path] of [
    ["Golden Mirror", "2.jpeg"],
    ["Festive Celebration", "1.jpeg"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("img", { name: new RegExp(name + " poster preview") }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (file) => {
          const image = new Image();
          image.src = "/frames/" + file;
          await image.decode();
          return [image.naturalWidth, image.naturalHeight];
        }, path),
      )
      .toEqual([900, 1600]);
    await expect(
      page.getByRole("button", { name: "Add frame image" }),
    ).toHaveCount(0);
  }
});

test("Others shares the completed poster with the generated SKY caption", async ({
  page,
}) => {
  await mockCamera(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          Object.assign(window, { copiedSkyCaption: text });
        },
      },
    });
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        // Decode the shared image to check its real size (any format).
        const image = await createImageBitmap(data.files![0]);
        Object.assign(window, {
          skyShare: {
            text: data.text,
            files: data.files!.length,
            type: data.files![0].type,
            width: image.width,
            height: image.height,
          },
        });
      },
    });
  });
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await openSharePage(page);
  await page.getByRole("button", { name: "Share on other apps" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { skyShare?: unknown }).skyShare,
      ),
    )
    .toMatchObject({
      files: 1,
      type: "image/jpeg",
      width: 1080,
      height: 2400,
      text: expect.stringContaining("@skymobileandelectronics"),
    });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { copiedSkyCaption?: string }).copiedSkyCaption,
      ),
    )
    .toContain("SKY Mobile & Electronics");
  // A link that isn't a web address is refused before it is sent.
  const others = page.locator("#share-more");
  await others.getByLabel("Link to your post").fill("my post");
  await others.getByRole("button", { name: "Send link" }).click();
  await expect(others).toContainText("starts with https://");
  await others.getByLabel("Link to your post").fill("https://x.com/asha/status/1");
  await others.getByRole("button", { name: "Send link" }).click();
  await expect(others).toContainText("Proof sent");
});

test("WhatsApp opens directly with the caption and poster link", async ({ page }) => {
  await mockCamera(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
  });
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await openSharePage(page);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Share on WhatsApp" }).click();
  const wa = await popup;
  expect(decodeURIComponent(new URL(wa.url()).searchParams.get("text") ?? "")).toContain(
    "@skymobileandelectronics",
  );
  await expect(page.getByLabel("WhatsApp Status screenshot")).toBeAttached();
  // A non-image file is refused.
  await page.getByLabel("WhatsApp Status screenshot").setInputFiles({
    name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hi"),
  });
  await expect(page.locator("#share-whatsapp")).toContainText("Choose a screenshot image");
});

test("selfie, product photos and generated poster persist locally and can be cleared", async ({
  page,
}) => {
  await mockCamera(page);
  await takeSelfie(page);
  await expect.poll(() => savedDraft(page)).toMatchObject({ selfie: true });
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.locator(".camera-stage canvas")).toHaveAttribute(
    "aria-label",
    /with your selfie/,
  );
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await spinAndClaim(page);
  await expect.poll(() => savedDraft(page)).toMatchObject({ selfie: true });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("sky-private-photos", 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const draft = await new Promise<any>((resolve) => {
          const r = db
            .transaction("drafts")
            .objectStore("drafts")
            .get("latest-draft");
          r.onsuccess = () => resolve(r.result);
        });
        db.close();
        return {
          selfie: draft?.selfie?.blob instanceof Blob,
          product: draft?.products?.[0]?.blob instanceof Blob,
          poster: draft?.poster instanceof Blob,
        };
      }),
    )
    .toEqual({ selfie: true, product: true, poster: true });
  await page.reload();
  await expect(page.locator(".editor-poster canvas")).toHaveAttribute(
    "aria-label",
    /with your selfie and 1 purchased product photos/,
  );
  await expect(
    page.getByRole("button", { name: "Post on Instagram", exact: true }),
  ).toBeEnabled();
  // Next customer clears this visit's photos from the device.
  await page.getByRole("button", { name: "Next customer" }).click();
  await expect.poll(() => savedDraft(page)).toEqual({ selfie: false });
});

test("a smile or hand gesture takes the selfie by itself after 3-2-1", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mockCamera(page, false, true);
  await page.goto("/?spin=test-token");
  const toggle = page.getByRole("button", { name: /Auto capture on/ });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  // No cue yet: nothing happens.
  await page.waitForTimeout(1000);
  await expect(page.locator(".auto-countdown")).toHaveCount(0);
  // A held ✌️ starts the countdown, then the selfie is taken.
  await page.evaluate(() =>
    Object.assign(window, { skyFakeCue: { smile: 0, gesture: "Victory" } }),
  );
  await expect(page.locator(".auto-countdown")).toContainText("✌️");
  await expect(
    page.getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    }),
  ).toBeVisible({ timeout: 10_000 });
});
test("auto capture can be switched off", async ({ page }) => {
  test.setTimeout(90_000);
  await mockCamera(page, false, true);
  await page.goto("/?spin=test-token");
  const toggle = page.getByRole("button", { name: /Auto capture on/ });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await toggle.click();
  await expect(
    page.getByRole("button", { name: /Auto capture off/ }),
  ).toBeVisible();
  await page.evaluate(() =>
    Object.assign(window, { skyFakeCue: { smile: 0.9, gesture: "" } }),
  );
  await page.waitForTimeout(1500);
  await expect(page.locator(".auto-countdown")).toHaveCount(0);
});
test("a failed customer upload is kept and retried until it succeeds", async ({
  page,
}) => {
  const attempts: string[] = [];
  let online = false;
  await page.route("**/api/customers/", (route) => {
    attempts.push(online ? "ok" : "fail");
    return online
      ? route.fulfill({ status: 201, json: { id: 1 } })
      : route.abort("internetdisconnected");
  });
  await mockCamera(page);
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await spinAndClaim(page);
  await expect.poll(() => attempts.length).toBeGreaterThan(0);
  online = true;
  // The browser regaining connectivity flushes the outbox.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => attempts.at(-1)).toBe("ok");
  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open("sky-upload-outbox", 1);
        r.onsuccess = () => {
          const c = r.result
            .transaction("uploads")
            .objectStore("uploads")
            .count();
          c.onsuccess = () => resolve(c.result);
        };
      }),
  );
  expect(left).toBe(0);
});

test("after posting, the customer sees whether the poster reached SKY", async ({
  page,
}) => {
  let up = false;
  await page.route("**/api/customers/", (route) =>
    up
      ? route.fulfill({ status: 201, json: { id: 1 } })
      : route.abort("connectionrefused"),
  );
  await mockCamera(page);
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await spinAndClaim(page);
  await expect(page.locator(".upload-status")).toHaveText(
    /will upload automatically/,
  );
  up = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".upload-status")).toHaveText(
    /Poster saved with SKY/,
  );
});

const failCamera = (name: string, granted = false) => async ({ page }: { page: Page }) => {
  await page.addInitScript(
    ([errorName, isGranted]) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          throw new DOMException("Camera failed", errorName as string);
        },
      });
      if (isGranted)
        Object.defineProperty(navigator, "permissions", {
          value: { query: async () => ({ state: "granted", onchange: null }) },
        });
    },
    [name, granted] as const,
  );
  await page.goto("/?spin=test-token");
};

test("allowed in the browser but blocked by the phone: phone settings steps", async ({ page }) => {
  await failCamera("NotAllowedError", true)({ page });
  const alert = page.getByRole("alertdialog", { name: "Turn on the camera in your phone settings" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Open the Settings app.");
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("a camera in use elsewhere says so", async ({ page }) => {
  await failCamera("NotReadableError")({ page });
  await expect(
    page.getByRole("alertdialog", { name: "The camera is in use or switched off" }),
  ).toContainText("Close any app using the camera");
});

test("inside Instagram's built-in browser: open in a real browser", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0",
  });
  const page = await context.newPage();
  await page.route("**/api/customers/link/**", (route) =>
    route.fulfill({
      json: { phone: "9845012345", name: "Asha", reward: "power-bank", items: [], poster: null, next: "mirror", video_review: true },
    }),
  );
  await failCamera("NotAllowedError")({ page });
  const alert = page.getByRole("alertdialog", { name: "Open this page in your browser" });
  await expect(alert).toContainText("Safari");
  await expect(alert.getByRole("button", { name: "Copy link" })).toBeVisible();
  await context.close();
});

test("guided sharing: Instagram link, WhatsApp, then the gift", async ({ page }) => {
  const events: { kind: string; url?: string }[] = [];
  await mockCamera(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
  });
  await takeSelfie(page);
  await page.getByRole("button", { name: "Capture product and post on Instagram", exact: true }).click();
  await openSharePage(page);
  await page.route("**/api/customers/event/", (r) => {
    events.push(r.request().postDataJSON() as { kind: string; url?: string });
    return r.fulfill({ json: { ok: true } });
  });
  // Proofs are uploaded; staff verification is simulated by flipping this.
  let verified = false;
  const progress = () => ({ instagram_post: true, instagram_proof: "", instagram_follow: verified ? "verified" : "pending",
    whatsapp_status: verified ? "verified" : "pending", google_review_opened: true, ready: verified });
  for (const kind of ["whatsapp", "follow"])
    await page.route(`**/api/customers/${kind}-proof/**`, (r) =>
      r.request().method() === "POST"
        ? r.fulfill({ json: { status: "pending" } })
        : r.fulfill({ json: { status: "pending", progress: progress() } }),
    );
  const png = { name: "shot.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") };
  const continueBtn = page.getByRole("button", { name: "Continue", exact: true });
  await expect(continueBtn).toBeDisabled();
  // Instagram: open the app, then the post's link (checked by its pattern).
  const ig = page.locator("#share-instagram");
  let popup = page.waitForEvent("popup");
  await ig.getByRole("button", { name: "Share on Instagram" }).click();
  await (await popup).close();
  await ig.getByLabel("Link to your Instagram post").fill("https://example.com/not-instagram");
  await ig.getByRole("button", { name: "Send link" }).click();
  await expect(ig).toContainText("Instagram post, reel or story");
  await ig.getByLabel("Link to your Instagram post").fill("https://www.instagram.com/reel/C1a2b3/");
  await ig.getByRole("button", { name: "Send link" }).click();
  await expect(ig).toContainText("Proof sent");
  // WhatsApp: open the app, then a Status screenshot.
  popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Share on WhatsApp" }).click();
  await (await popup).close();
  await page.getByLabel("WhatsApp Status screenshot").setInputFiles(png);
  await expect(page.locator("#share-whatsapp")).toContainText("Proof sent");
  await continueBtn.click();
  // Follow our Instagram: open the profile, then a "Following" screenshot.
  await expect(page.getByRole("heading", { name: "Step 2: Follow us on Instagram" })).toBeVisible();
  const profile = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open our Instagram" }).click();
  await (await profile).close();
  await page.getByLabel("Instagram following screenshot").setInputFiles(png);
  // Optional Google review, then the progress checklist.
  await expect(page.getByRole("link", { name: "Leave a Google review" })).toHaveAttribute("href", /share\.google/);
  await page.getByRole("button", { name: "Continue" }).click();
  // No gift until staff verify the screenshots.
  await expect(page.getByRole("heading", { name: "Waiting for SKY to verify" })).toBeVisible();
  await expect(page.locator(".share-page")).toContainText("Following on Instagram: ⏳ being checked");
  verified = true;
  await expect(page.getByRole("heading", { name: "Get your gift from the store!" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".share-page")).toContainText("Power Bank");
  const kinds = events.map((e) => e.kind);
  for (const k of ["share_opened_instagram", "share_opened_whatsapp", "posted_instagram", "gift_unlocked"])
    expect(kinds).toContain(k);
});
