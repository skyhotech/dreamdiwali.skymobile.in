import { test, expect, type Page } from "@playwright/test";
// Never write test customers into the real backend: stub the upload endpoint.
// Individual tests can override this with their own page.route().
// Customers are signed in by mobile number; the server picks the prize once.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/customers/", (route) =>
    route.fulfill({ status: 201, json: { id: 0 } }),
  );
  await page.route("**/api/customers/register/", (route) =>
    route.fulfill({ json: { phone: "9845012345", reward: null } }),
  );
  await page.route("**/api/customers/spin/", (route) =>
    route.fulfill({ json: { reward: "smart-watch" } }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("sky-customer-phone", "9845012345"),
  );
});
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
  await page.goto("/");
  await expect(
    page
      .locator(".camera-stage")
      .getByRole("button", { name: "Post on Instagram", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Post on Instagram", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    }),
  ).toBeEnabled();
}
// The prize wheel opens after the first product photo, spins by itself and
// the prize is added to the poster automatically.
async function spinAndClaim(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog", { name: "Spin the wheel" });
  await dialog.getByRole("button", { name: "Tap to spin" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/You won a/, {
    timeout: 10_000,
  });
  await expect(dialog).toBeHidden({ timeout: 10_000 });
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
  await spinAndClaim(page);
  await expect(
    page.getByRole("textbox", { name: "Your SKY Instagram caption" }),
  ).toBeVisible();
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
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
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
        const bytes = new Uint8Array(await data.files![0].arrayBuffer());
        Object.assign(window, {
          skyShare: {
            text: data.text,
            files: data.files!.length,
            type: data.files![0].type,
            width: new DataView(bytes.buffer).getUint32(16),
            height: new DataView(bytes.buffer).getUint32(20),
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
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { skyShare?: unknown }).skyShare,
      ),
    )
    .toMatchObject({
      files: 1,
      type: "image/png",
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
  const dl = page.waitForEvent("download"),
    popup = page.waitForEvent("popup");
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await spinAndClaim(page);
  expect((await dl).suggestedFilename()).toContain("SKY-Diwali");
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
  // Next customer clears this visit and signs the customer out.
  await page.getByRole("button", { name: "Next customer" }).click();
  await expect(page.getByLabel("Mobile number", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("sky-customer-phone")),
  ).toBeNull();
});

test("prize wheel spins after the product photo and puts the reward on the poster", async ({
  page,
}) => {
  let spins = 0;
  await page.route("**/api/customers/spin/", (route) => {
    spins++;
    return route.fulfill({ json: { reward: "smart-watch" } });
  });
  await mockCamera(page);
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Spin the wheel" });
  await expect(dialog).toBeVisible();
  // A double tap must not start two spins.
  await dialog.getByRole("button", { name: "Tap to spin" }).dblclick();
  await expect(dialog.getByRole("status")).toHaveText("Good luck…");
  await expect(dialog.getByRole("button")).toHaveCount(0);
  // The wheel must visibly turn, not jump straight to the result.
  const angle = () =>
    page
      .locator(".spin-wheel")
      .evaluate((el) => getComputedStyle(el).transform);
  const early = await angle();
  await page.waitForTimeout(400);
  expect(await angle()).not.toBe(early);
  await expect(dialog.getByRole("status")).toHaveText(
    /You won a (Neck Band|Mini Speaker|Smart Watch|Wired Headphone|Mobile Stand|Power Bank)!/,
    { timeout: 10_000 },
  );
  await expect(dialog).toContainText("Adding your gift to the poster");
  await expect(
    dialog.getByRole("button", { name: "Add to my poster" }),
  ).toHaveCount(0);
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  await expect(
    page.getByRole("textbox", { name: "Your SKY Instagram caption" }),
  ).toBeVisible();
  // One spin, one prize: never a second request.
  expect(spins).toBe(1);
});

test("a smile or hand gesture takes the selfie by itself after 3-2-1", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mockCamera(page, false, true);
  await page.goto("/");
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
  await page.goto("/");
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
test("the wheel turns right away even when the prize is slow to arrive", async ({
  page,
}) => {
  // Slow phone or network: the face check and server take a few seconds.
  await page.route("**/api/customers/spin/", async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ json: { reward: "smart-watch" } });
  });
  await mockCamera(page);
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Spin the wheel" });
  await dialog.getByRole("button", { name: "Tap to spin" }).click();
  const angle = () =>
    page
      .locator(".spin-wheel")
      .evaluate((el) => getComputedStyle(el).transform);
  // Before the prize is known the wheel must already be moving. (Samples
  // avoid 500 ms steps: one full turn takes 500 ms at waiting speed.)
  await page.waitForTimeout(300);
  const a = await angle();
  await page.waitForTimeout(130);
  const b = await angle();
  await page.waitForTimeout(170);
  expect(new Set([a, b, await angle()]).size).toBe(3);
  await expect(dialog.getByRole("status")).toHaveText(
    "You won a Smart Watch!",
    {
      timeout: 12_000,
    },
  );
});
test("a face that already claimed a gift sees a clear message", async ({
  page,
}) => {
  await page.route("**/api/customers/spin/", (route) =>
    route.fulfill({
      status: 409,
      json: {
        detail:
          "You have already claimed your Diwali gift. Each guest is eligible for one gift only. Thank you for celebrating with SKY!",
        code: "face_registered",
      },
    }),
  );
  await mockCamera(page);
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Spin the wheel" });
  await dialog.getByRole("button", { name: "Tap to spin" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    /already claimed your Diwali gift/,
  );
  await expect(dialog.getByRole("status")).not.toHaveText(/You won/);
});
test("reloading during the prize wheel cannot re-roll the prize", async ({
  page,
}) => {
  await mockCamera(page);
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Spin the wheel" });
  await dialog.getByRole("button", { name: "Tap to spin" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/You won a (.+)!/, {
    timeout: 10_000,
  });
  const first = await dialog.getByRole("status").textContent();
  // Customer reloads instead of claiming, hoping for a better prize.
  await page.reload();
  const again = page.getByRole("dialog", { name: "Spin the wheel" });
  await expect(again).toBeVisible();
  await again.getByRole("button", { name: "Tap to spin" }).click();
  await expect(again.getByRole("status")).toHaveText(first!, {
    timeout: 10_000,
  });
  await expect(again).toBeHidden({ timeout: 5_000 });
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

test("customers must enter a valid mobile number before the studio opens", async ({
  page,
}) => {
  const registered: string[] = [];
  await page.route("**/api/customers/register/", async (route) => {
    const { phone } = route.request().postDataJSON() as { phone: string };
    registered.push(phone);
    await route.fulfill({ json: { phone, reward: null } });
  });
  await page.addInitScript(() => localStorage.removeItem("sky-customer-phone"));
  await mockCamera(page);
  await page.goto("/");
  const field = page.getByLabel("Mobile number", { exact: true });
  await expect(field).toBeVisible();
  await expect(page.locator(".camera-stage")).toHaveCount(0);
  const go = page.getByRole("button", { name: "Proceed" });
  await field.fill("12345");
  await expect(go).toBeDisabled();
  await field.fill("5876543210");
  await expect(go).toBeDisabled();
  // Made-up looking numbers are refused too.
  for (const fake of ["9876543210", "9999999999", "9000000000", "9898989898"]) {
    await field.fill(fake);
    await expect(go).toBeDisabled();
  }
  await expect(
    page.getByText("Enter a valid 10-digit mobile number."),
  ).toBeVisible();
  await field.fill("9123456789");
  await expect(page.getByText(/agree to a selfie & face check/)).toBeVisible();
  await go.click();
  await expect(page.locator(".camera-stage")).toBeVisible();
  expect(registered).toEqual(["9123456789"]);
});

test("a number that already won gets its prize back without spinning", async ({
  page,
}) => {
  await page.route("**/api/customers/register/", (route) =>
    route.fulfill({ json: { phone: "9845012345", reward: "power-bank" } }),
  );
  await mockCamera(page);
  await takeSelfie(page);
  await page
    .getByRole("button", {
      name: "Capture product and post on Instagram",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Spin the wheel" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Your SKY Instagram caption" }),
  ).toBeVisible();
});

// Reads what the studio saved on the device (the storage status bar is hidden).
async function savedDraft(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ selfie: boolean; product: boolean }>((resolve) => {
        const r = indexedDB.open("sky-private-photos", 1);
        r.onsuccess = () => {
          const g = r.result
            .transaction("drafts")
            .objectStore("drafts")
            .get("latest-draft");
          g.onsuccess = () =>
            resolve({
              selfie: g.result?.selfie?.blob instanceof Blob,
              product: g.result?.products?.[0]?.blob instanceof Blob,
            });
          g.onerror = () => resolve({ selfie: false, product: false });
        };
        r.onerror = () => resolve({ selfie: false, product: false });
      }),
  );
}

test("sign-in shows a clear message for each kind of failure", async ({
  page,
  context,
}) => {
  let mode: "busy" | "server" | "down" = "busy";
  await page.route("**/api/customers/register/", (route) =>
    mode === "busy"
      ? route.fulfill({
          status: 429,
          headers: { "Retry-After": "45" },
          json: { detail: "Request was throttled." },
        })
      : mode === "server"
        ? route.fulfill({ status: 500, body: "<html>Server Error</html>" })
        : route.abort("connectionrefused"),
  );
  await page.addInitScript(() => localStorage.removeItem("sky-customer-phone"));
  await mockCamera(page);
  await page.goto("/");
  await page.getByLabel("Mobile number", { exact: true }).fill("9123456789");
  const go = page.getByRole("button", { name: "Proceed" });
  const help = page.locator("#phone-help");
  await go.click();
  await expect(help).toHaveText(
    "Too many tries. Please wait 45 seconds and try again.",
  );
  mode = "server";
  await go.click();
  await expect(help).toHaveText(
    "Something went wrong on our side. Please try again in a moment.",
  );
  mode = "down";
  await go.click();
  await expect(help).toHaveText(
    "Can't reach SKY right now. Please try again in a moment.",
  );
  // Losing the connection shows a banner and a clear message on submit.
  await context.setOffline(true);
  await expect(page.locator(".offline-banner")).toBeVisible();
  await go.click();
  await expect(help).toHaveText(
    "You're offline. Check the Wi-Fi or mobile data and try again.",
  );
  await context.setOffline(false);
  await expect(page.locator(".offline-banner")).toBeHidden();
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
