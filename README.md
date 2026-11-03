# Production

Live site: https://dreamdiwali.skymobile.in. Pushing to `main` runs CI, then deploys to the VPS.

1. Point the domain's DNS A record at the VPS.
2. As root on a fresh Ubuntu VPS: `bash deploy/vps/bootstrap.sh`, then fill in `/etc/skymirror/.env`.
3. Add repo secrets `VPS_HOST`, `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS`.
4. After the first deploy: `skymirror-manage createsuperuser`.

# SKY Diwali Selfie Studio

A mobile-first, browser-only Diwali poster camera for **SKY Mobile & Electronics**. Customers take a selfie, capture their actual purchase in the poster’s small product card, and share the completed poster with a generated SKY Instagram caption.

## Start locally

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Installation automatically prepares MediaPipe WASM files and downloads the face-landmarker and selfie-segmentation models into `public/ai/`. No API keys or paid services are required. The Django backend (see below) is optional; without it the studio uses the built-in frames and keeps photos on the device. Internet access is needed for the first installation. If an optional model download fails, run `npm run setup` again; manual camera capture remains available.

Open the localhost URL printed by Vite. Phone camera access requires **HTTPS**; an ordinary HTTP LAN address usually cannot use cameras. Browser camera permission must be granted.

## Customer flow

1. Opening the link goes directly to the front-camera poster preview. There is no welcome screen, upload-photo button, or camera-flip button.
2. Swipe or use the bottom slider to select one of the two original frames.
3. Tap **Post on Instagram** inside the poster to capture the selfie. The selfie stays in the large mirror, and the rear camera automatically opens inside the small purchased-product card. If the rear camera is unavailable, the front camera is selected automatically.
4. Tap **Capture product & post**. The product photo is captured without selfie effects or mirroring, the camera stops, and a 1080 × 1920 poster is generated with both actual photos.
5. The app immediately attempts to share the poster and generated SKY caption through the device share sheet. Choose **Instagram → Post/Feed** when available. The caption is also copied when browser permissions allow; paste it if Instagram omits supplied text.

After capture, customers can retake the product, add another product (up to five), download, or open the editor. The editor supports photo positioning and zoom, product layouts, optional customer-entered captions, PNG/JPEG, and optional 2160 × 3840 output. Preview and export use the same Canvas renderer. Camera controls and posting buttons are never included in the exported image.

## Original frames included

- `public/frames/1.jpeg`: Festive Celebration, 900 × 1600.
- `public/frames/2.jpeg`: Golden Mirror, 900 × 1600.

Both load automatically for every visitor. There is no frame-upload prompt. The supplied SKY logo and promotional text remain part of the original artwork. The compositor removes the neutral mirror surface for the selfie and places actual product photos in the existing bottom card. Decorative lights, typography, and frame details remain in front. Check mask edges on real devices, especially near hair, warm highlights, and promotional badges.

## Selfie effects

The Smile filter is always enabled at **100% configured strength**, with no visible filter controls. It uses local MediaPipe face landmarks and a geometric mouth warp; it is a playful camera filter rather than generative expression replacement.

Portrait mode uses a local selfie-segmentation model to keep the person sharp while applying **20% background blur and warm golden bokeh lights** behind them. Here, 20% maps to a 4.8px blur radius at a 1080px short edge, scaled to the processed selfie resolution. Effects are included in captured selfies and exports. Product photos are unfiltered.

Inference runs at a controlled cadence, pauses with camera/tab lifecycle changes, and releases models and media tracks on unmount. Unsupported or failed effects fall back to normal manual photography with a status message. Hair edges, fast movement, lighting, expression appearance and performance need real-phone validation.

## Browser-local photo storage

The latest selfie, product photos, edits, selected frame/layout and generated poster are automatically stored as Blobs in **IndexedDB** on the customer’s browser. Refresh restores a selfie-only draft to product capture, or a completed draft to the editor. This is local storage, not cloud backup.

**Clear saved photos** deletes the saved draft and poster and starts again. **Create another** also clears the previous draft. Only the latest session is retained, not a photo history. Browser data clearing, storage eviction, private browsing or quota restrictions can affect persistence. Saving failures are shown without blocking camera capture or downloads. Important posters can be downloaded separately.

## Instagram behavior and limitations

The generated caption includes SKY Mobile & Electronics, `@skymobileandelectronics`, and festive hashtags. Optional product labels are included only when the customer supplies them; product specifications, prices and discounts are not invented.

A website cannot force a particular installed share app, guarantee Instagram’s Post composer or caption autofill, or confirm actual publication. The customer chooses Instagram in the share sheet and completes the post. If sharing is unsupported, the poster downloads and the app attempts to open instagram.com. Use **Open Instagram** if the browser blocks the new tab, then select **+ → Post**, the saved poster, and paste the caption.

Some browsers expire the click activation while the captured image is encoded and the poster is generated. If the first sharing attempt is refused, the prepared file and caption remain available; tap **Post on Instagram** again for a fresh sharing action. Cancelled or failed sharing preserves the data. No Instagram account token, login, or publishing API is used.

## Privacy

Facial landmarks, segmentation masks and expression scores are processed on the device and never persisted. When the Django backend is running, each exported poster and its original selfie are uploaded to it and shown to staff under **Customers**; without the backend, photos stay in the browser. There are no analytics or third-party image-processing services. Get customer consent before storing selfies.

Camera tracks stop before switching cameras, after completing a capture, when leaving the camera component, and while the tab is hidden. Blob URLs are revoked when photos are replaced or cleared.

## Build and deploy

```sh
npm run check
npm run build
npm run preview
```

Deploy `dist/` to any HTTPS static host. A typical build configuration is:

- Install: `npm ci` (includes automatic model setup).
- Build: `npm run build`.
- Output directory: `dist`.

Allow same-origin MediaPipe scripts/WASM and local inference if adding a Content Security Policy. Serve `.wasm` as `application/wasm`. Relative asset paths support deployment beneath a subdirectory. No server-side application is needed unless you use the backend.

`node_modules/`, `dist/`, test reports and downloaded `public/ai/` files are deliberately excluded from Git. Source, the lockfile, setup script and both original frames are included.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

Unit tests cover smile-warp behavior, both frame layouts, generated captions, portrait strength and confidence alpha. Chromium desktop/mobile tests cover direct camera opening, front/rear selection and fallback, a live product preview in the small product card, combined poster export, share payloads and caption copying, download/open-Instagram fallback, missing-control assertions, foreground/background compositing, and IndexedDB refresh/clear behavior.

Camera streams, share targets and test customer images are synthetic. Automated mobile viewports are not real iPhone/Android hardware tests. Check actual Safari/Chrome camera permissions, rear-camera behavior, mirror orientation, hair/face effect quality, gestures, memory limits, storage availability and Instagram share targets on real phones before a campaign.

## Source guide

- `src/components/CameraStudio.tsx`: inline selfie/product capture and immediate sharing.
- `src/components/Editor.tsx`: editing, export, captions and sharing.
- `src/components/Templates.tsx`: mobile two-frame slider.
- `src/templates/index.ts`: original artwork paths and design-space coordinates.
- `src/lib/renderer.ts`: shared preview/export compositor and mirror masks.
- `src/hooks/useCamera.ts`: camera requests, fallback and cleanup.
- `src/hooks/useExpression.ts`: local Smile and portrait inference.
- `src/lib/portrait.ts`: sharp-person/background-blur and gold-light compositing.
- `src/lib/persistence.ts`: IndexedDB draft restoration and serialized saves.
- `src/lib/store.ts`: session state and Blob lifecycle.
- `src/lib/sharing.ts`: SKY caption and clipboard helpers.
- `scripts/setup.mjs`: automatic local AI runtime/model provisioning.

Implementation references: [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [MediaPipe Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter), [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).

## Backend (Django REST Framework)

`backend/` holds the mirror-theme API and the staff dashboard.

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                            # then set DJANGO_SECRET_KEY
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_mirrors        # imports public/frames as mirrors
.venv/bin/python manage.py createsuperuser
.venv/bin/python manage.py runserver 8000   # or just `npm run dev` from the root
```

`npm run dev` starts Django and Vite together. Open <http://localhost:5173/> for the studio and <http://localhost:5173/sky/mirror/admin/> for the dashboard.

- Dashboard: <http://localhost:8000/sky/mirror/admin/>, with **Dashboard**, **Mirrors** and **Customers** in the sidebar.
  - **Mirrors** lets you create, edit and delete themes and upload artwork. Drag the selfie and product boxes on the artwork to place them, and drag ⠿ to reorder the list.
  - **Customers** shows every exported poster with the original selfie and the mirror theme used.
- The studio (`npm run dev`) proxies `/api` and `/media` to port 8000 and listens on `GET /api/mirrors/stream/` (server-sent events), so admin edits appear instantly without a refresh. If the stream drops, it falls back to checking `GET /api/mirrors/version/` every second.
- Each exported poster is uploaded to `POST /api/customers/`. Re-exporting the same selfie updates its record instead of adding a new one.
- Production: set `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`, `DJANGO_ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS`, and set `VITE_API_URL` when the API is on another origin.

### Customers, prizes and face check

- Every customer signs in with a mobile number first. Fake-looking numbers such as 9876543210 or 9999999999 are refused. Each number gets one customer record and one prize, picked by the server.
- Tapping **Proceed** counts as consent to the selfie and face check. The browser turns the selfie into a 128-number face fingerprint (`@vladmandic/face-api`; models are copied to `public/ai/face` by `npm run setup`). If the same face already won under another number, the customer gets that earlier prize, and the dashboard flags it with "⚠ Same face as …".

### Security and rate limits

- API limits are counted per IP: register 60/min, spin 120/hour, upload 120/min, and 600/min for everything else. Each mobile number is also limited to 10 requests an hour, and each network to 20 open live-update streams.
- Staff sign-in locks a username or network for 15 minutes after 5 failed attempts.
- Uploads must be PNG, JPEG or WebP images of 12 MB or less.
- With `DJANGO_DEBUG=0` the backend refuses to start without a `DJANGO_SECRET_KEY`. It also turns on HTTPS redirect, HSTS and secure cookies. `manage.py check --deploy` passes.
- When running more than one server process, set `REDIS_URL` so all processes share the rate-limit counters.

### Backups (prevent data loss)

```bash
cd backend && .venv/bin/python manage.py backup   # → backend/backups/, keeps the newest 14
# cron, every 6 hours:
# 0 */6 * * * cd /path/to/skydiwalimirror/backend && .venv/bin/python manage.py backup
```

The database runs in WAL mode, so kiosks uploading at the same time wait for each other instead of failing. **Export CSV** under Customers downloads every customer.
