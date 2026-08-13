# Gavan Guided Capture (preliminary)

A guided smile capture PWA for shade-matching workflows. The live view is
a "Smart Frame": a color-coded outline around the tracked mouth region
(green once every active gate passes, amber otherwise) plus a prompt
banner telling the clinician what to fix, and a compact numeric readout
(pitch/yaw/roll/MAR) for anyone who wants the raw numbers instead of just
the color. Capture is both automatic (fires once every gate has held
passing for a few consecutive frames) and manual (a shutter button that
works any time a face is detected, angle notwithstanding). Frames come
straight off the raw camera track, never from encoded video, cropped to
the mouth bounding box, with the pose/smile/card readout burned into the
saved image.

A **Cardboard** toggle (top-left) switches the guidance between two
modes:

- **Without cardboard**: the Smart Frame gates on head pose (pitch/yaw,
  each independently within 15 degrees) and smile width (Mouth Aspect
  Ratio, so a closed or half smile doesn't pass as "smiling").
- **With cardboard**: adds a dashed guide area below the mouth showing
  where to hold the calibration card, and a gate requiring all of its
  ArUco fiducial markers to be visible and the card held flat (checked
  via the marker quad's diagonal ratio). The system also estimates the
  light source direction from a specular highlight on the card, stored
  alongside the image as auxiliary color-accuracy data.

The viewfinder keeps going after each shot (instead of stopping) so you
can vary your angle and build up a set to choose from. Everything is
saved on-device via IndexedDB, with the pose/smile/card/light data
attached to each capture; a gallery screen lets you review, save to
device, or delete, and nothing is ever uploaded.

This is still a prototype: the core capture loop works end to end and
is worth trying, but several items are deliberately simplified or
unverified, especially around the calibration card (no real card design
to test against yet) and light estimation (an intentionally simple
heuristic, not photometric stereo). See "What's simplified" below before
treating this as production-ready.

## Running it

```bash
npm install
npm run dev
```

Open the printed URL on a phone (or desktop with a webcam) over HTTPS or
localhost, getUserMedia requires a secure context. Camera access needs
a real device; this cannot be verified in a sandboxed CI environment.

```bash
npm test          # gate evaluator + capture store unit tests (vitest)
npm run build     # typecheck + production build + service worker
npm run preview   # serve the production build locally
```

Two smoke-test scripts exercise the built app in headless Chromium with
a fake camera device (useful after any change, no real hardware needed):

```bash
node scripts/smoke-test.mjs     # permission -> viewfinder -> debug page, no console errors
node scripts/offline-test.mjs   # confirms the app (incl. camera + model) loads with network off
```

## Verifying angle on a real device

`/debug.html` and the live view's numeric readout read off the same
tracker code path. Face the camera straight on (`pitchDeg`/`yawDeg`
should read near 0), turn left and right (`yawDeg` should rise similarly
both ways and flip sign), tilt the chin up and down (`pitchDeg` should
flip sign), tilt the head sideways (`rollDeg` changes, pitch/yaw stay
low). If a sign is backwards, flip `X_SIGN` / `Y_SIGN` in
`src/tracker/mediapipeTracker.ts`; everything else reads from the
derived angles, nothing else needs to change.

Confirmed on-device: the direction arrow pointed the wrong way
left/right (`X_SIGN` was flipped from `1` to `-1` to fix it); up/down
was correct as shipped. Both `src/tracker/mediapipeTracker.ts` and
`src/gates/directionPrompt.ts` document this.

## The capture loop

- **Switch** (top-left) swaps front/rear camera at any time, no reload.
- **Flash** (top-left) toggles torch mode. Only shown when the active
  camera actually reports torch support, front cameras almost never do.
- **Cardboard** (top-left) toggles the with/without-card Smart Frame
  mode described above. Switching it resets the hold-to-capture state so
  a half-finished hold under the old gate set doesn't carry over.
- Watch the Smart Frame outline and prompt banner. Once every active
  gate holds passing for `THRESHOLDS.holdFramesRequired` consecutive
  frames, capture fires automatically. You can also tap **Capture** at
  any time regardless of gate state, this is guidance, not a lock.
- Capture locks exposure/WB/focus at the *current* auto-computed values
  if the platform allows it (`src/capture/deviceCamera.ts` reads
  `track.getSettings()` before switching to manual, since switching
  without a value snaps some devices to a near-black default instead of
  preserving what the preview was showing), then samples raw frames
  across a 5-second window (`CAPTURE_SEQUENCE`, config.ts) cropped to
  the tracked mouth bounding box, keeps the sharpest with the least
  clipping (the "manage reflections" step), burns the pose/smile/card
  readout into it, and saves it with the full metadata set.
- The viewfinder keeps going after each shot. Up to `MAX_SESSION_CAPTURES`
  (8, in `src/config.ts`) per sitting; the button reads "Full" once you
  hit that.
- **Gallery** (top-right) is always visible, not gated behind capturing
  something this session, tap it any time to open a grid of everything
  saved this session and before. Tap a thumbnail for the full image, its
  metadata (pitch/yaw/roll/MAR, exposure lock, and, when captured with
  the card, marker/flatness status and light direction), a **Save to
  device** download, or **Delete**.
- All storage is `src/storage/captureStore.ts`, a thin IndexedDB
  wrapper. No network calls, no server. **Clear all** in the gallery
  wipes it.

The older 7-gate system (`src/gates/gateEvaluator.ts`,
`src/capture/captureController.ts`, distance/centering/stability/exposure)
predates the Smart Frame spec and is no longer wired into `main.ts`, it's
kept compiling and unit-tested but superseded by `src/gates/smartFrameEvaluator.ts`.

## ArUco loading: why it's a vendored `<script>`, not an import

`js-aruco2` is a legacy global-scope library (`this.AR = AR` at module
top level, written to run as a plain `<script>` tag where `this` is
`window`). Importing it through Vite/Rollup's CommonJS interop builds
without error but breaks at runtime, the interop wrapper doesn't bind
`this` to the module's exports the way Node's real CJS wrapper does, so
`AR` comes back `undefined`. `public/vendor/js-aruco2/` vendors the
library's three source files (`cv.js`, `aruco.js`,
`dictionaries/aruco_mip_36h12.js`) verbatim; `src/capture/cardDetector.ts`
loads them as real script tags in that order at startup and reads
`window.AR`, sidestepping the interop entirely. They're precached by the
service worker the same way the MediaPipe model/wasm assets are, so card
detection still works offline.

## Config decision open (handoff Section 10)

`CAPTURE_MODE` in `src/config.ts` is set to `'front'`. Both `'front'`
and `'rear'` paths are implemented (mirroring, direction prompts, and
facingMode all read from this one constant), but which one ships is
Michael's call: front enables unassisted patient self-capture, rear
gives materially better color data but needs a clinician or assistant
operating the phone.

## What's simplified

- **Calibration card layout is a placeholder.** `CARD_CONFIG` in
  `src/config.ts` assumes 4 corner markers (IDs 0-3, mapped in order to
  TL/TR/BR/BL) and a centered reference patch for light estimation. None
  of this is calibrated against a real printed card, there isn't one to
  test against yet. Replace once the real card design exists, per "off
  the shelf now, replace if inadequate".
- **Light direction is a coarse 2D heuristic, not photometric stereo.**
  `src/capture/lightEstimator.ts` finds the brightest spot inside the
  expected reference-patch region and reports its offset from center.
  That's a real signal (a highlight shifted toward one side means the
  light leans that way) but it is explicitly not a solved 3D light
  vector, there's no calibrated rig here for that.
- **MAR (smile-width) threshold is calibrated off one real reference
  sample, not a bank of photos.** `THRESHOLDS.smileMar` in
  `src/config.ts` (0.6 enter / 0.5 exit) was raised after the original
  0.35/0.28 guess was confirmed on-device to pass a regular smile, not
  just a wide one showing both arches (the reference capture scored
  mar ~0.78). Expect to retune with headroom in either direction once
  there's a bank of real smile photos across different mouth shapes.
- **No Web Worker.** The tracker and gate evaluator run on the main
  thread, driven by `requestVideoFrameCallback`. Both layers are already
  pure and DOM-free, so moving them into a worker is straightforward but
  not done here.
- **Full end-to-end capture is unverified in this environment.** No real
  camera/face/card was available to confirm the whole
  capture-to-burn-in-to-gallery pipeline, including actual ArUco
  detection, on a live shot; it's covered by unit tests (gate hysteresis
  for pitch/yaw/MAR/card, capture-store round-trips) and headless smoke
  tests (app loads, tracker initializes, cardboard toggle doesn't crash
  the loop), but not an actual photo of an actual card.
- **Unit tests cover gate evaluator behavior** (pitch/yaw hysteresis
  boundaries at 15/18, MAR hysteresis, the cardboard toggle's effect on
  which gates count, capture triggering, prompt priority and the 800ms
  minimum display lock) but not every hysteresis band exhaustively, and
  not ArUco detection accuracy itself (that's the vendored library's
  concern, not this codebase's).

## Architecture

Three-layer split:

- `src/tracker/` — Layer 1. `MediaPipeTracker` is the only file that
  imports `@mediapipe/tasks-vision`; everything else only sees the
  `TrackerResult` interface in `src/tracker/types.ts` (now including
  `pitchDeg`/`yawDeg`/`mar` alongside the original angle/roll fields), so
  the engine can be swapped later without touching gates or UI.
- `src/gates/` — Layer 2. `evaluateSmartFrame` in `smartFrameEvaluator.ts`
  is a pure function (no DOM access): same tracker result + card
  detection + cardboard-mode flag + prior state in, same evaluation out.
  All tuning constants live in `src/config.ts`.
- `src/ui/` and `src/capture/` — Layer 3. Camera setup, canvas overlay
  (Smart Frame outline + card guide, `src/ui/overlay.ts`), card detection
  (`src/capture/cardDetector.ts`) and light estimation
  (`src/capture/lightEstimator.ts`), the burst/lock/score capture
  sequence (`src/capture/captureSequence.ts`), and screens.

The MediaPipe model (`public/models/face_landmarker.task`), WASM runtime
(`public/wasm/`), and vendored ArUco library (`public/vendor/js-aruco2/`)
are all bundled locally and precached by the service worker, no CDN
calls, works offline.
