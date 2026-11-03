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
  if (!withAi) await page.route("**/ai/**", (r) => r.abort());
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
async function spinAndClaim(_page: import("@playwright/test").Page) {}
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
  await spinAndClaim(page);
  await expect(
    page.getByRole("textbox", { name: "Your SKY Instagram caption" }),
  ).toBeVisible();
  // Sharing opens from the customer's tap on Post on Instagram.
  await page
    .locator(".camera-stage")
    .getByRole("button", { name: "Post on Instagram", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { defaultSkyShare?: unknown }).defaultSkyShare,
      ),
    )
    .toMatchObject({
      files: 1,
      text: expect.stringContaining("@skymobileindia"),
    });
  await page.getByRole("button", { name: "Edit poster", exact: true }).click();
  await page
    .getByRole("button", { name: "Festive Celebration", exact: true })
    .click();
  // Kiosk editor: only the frame slider and posting remain.
  for (const hidden of [
    "Generate my poster",
    "Reset position",
    "Copy caption",
    "Clear saved photos",
  ])
    await expect(page.getByRole("button", { name: hidden })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Post on Instagram", exact: true }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("textbox", { name: "Your SKY Instagram caption" }),
  ).toBeVisible();
});
test("filter controls, uploads and flip controls are absent", async ({
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
      name: /Smile filter|Smile to capture|Upload photo|Flip camera/,
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
test("permission denial offers retry without upload or flip suggestions", async ({
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
  await expect(
    page.getByRole("alert").filter({ hasText: "SKY needs your camera" }),
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

test("Post on Instagram shares the completed poster with generated SKY caption", async ({
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
  await spinAndClaim(page);
  // Sharing opens from the customer's tap (phones refuse it otherwise).
  await expect(
    page.getByRole("status").filter({ hasText: "Your poster is ready" }),
  ).toBeVisible();
  await page
    .locator(".camera-stage")
    .getByRole("button", { name: "Post on Instagram", exact: true })
    .click();
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
      text: expect.stringContaining("@skymobileindia"),
    });
  await expect(
    page.getByRole("textbox", { name: "Your SKY Instagram caption" }),
  ).toHaveValue(/#DiwaliWithSKY/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { copiedSkyCaption?: string }).copiedSkyCaption,
      ),
    )
    .toContain("SKY Mobile & Electronics");
});

test("Instagram fallback downloads poster and opens Instagram with caption ready", async ({
  page,
  context,
}) => {
  await context.route("https://www.instagram.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<title>Instagram</title>" }),
  );
  await mockCamera(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: () => false });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
    });
  });
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await spinAndClaim(page);
  const dl = page.waitForEvent("download"),
    popup = page.waitForEvent("popup");
  await page
    .locator(".camera-stage")
    .getByRole("button", { name: "Post on Instagram", exact: true })
    .click();
  expect((await dl).suggestedFilename()).toMatch(/^SKY-Diwali-.+\.jpg$/);
  const instagram = await popup;
  await expect(instagram).toHaveURL("https://www.instagram.com/");
  await instagram.close();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Poster downloaded and Instagram opened" }),
  ).toBeVisible();
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
