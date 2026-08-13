# Gavan Guided Capture (preliminary)

A guided smile capture PWA per the [handoff spec](../). The main screen
is deliberately the same live view `/debug.html` always had: the video
feed, dots tracking the outer lip contour, and the raw pose numbers
(`offAxisDeg`, `offAxisVec`, `rollDeg`) on screen at all times, colored
green with an "OPTIMAL" tag once you're within 15 degrees of square-on.
A visible shutter button captures on demand, no auto-fire, so it's
always clear both what the current angle is and when you chose to
shoot. Frames come straight off the raw camera track, never from
encoded video, to feed a shade-matching pipeline.

The viewfinder keeps going after each shot (instead of stopping) so you
can vary your angle and build up a set to choose from, each with that
same pose readout burned into the image itself. Everything is saved
on-device via IndexedDB, a gallery screen lets you review, save to
device, or delete, and nothing is ever uploaded.

This is still a prototype: the core capture loop works end to end and
is worth trying, but several items are deliberately simplified or
unverified. See "What's simplified" below before treating this as
production-ready.

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

The main view and `/debug.html` now read the same numbers off the same
code path, so either one works for this. Follow handoff Section 5's
steps: face the camera straight on (`offAxisDeg` should read near 0),
turn left and right (it should rise similarly both ways, `offAxisVec.x`
should flip sign), tilt the chin up and down (`offAxisVec.y` should
flip sign), tilt the head sideways (`rollDeg` changes, `offAxisDeg`
stays low). If a sign is backwards, flip `X_SIGN` / `Y_SIGN` in
`src/tracker/mediapipeTracker.ts`, everything else reads from
`offAxisVec`, nothing else needs to change.

## The capture loop

- **Switch** (top-left) swaps front/rear camera at any time, no reload.
  Requeries `getUserMedia` with the other `facingMode`, stops the old
  track, and starts a fresh viewfinder session (session capture count
  and badge reset; anything already saved stays in the gallery).
- **Flash** (top-left, next to Switch) toggles torch mode via
  `track.applyConstraints({advanced:[{torch}]})`. Only shown when the
  active camera actually reports torch support, front cameras almost
  never do, so expect it to only appear on rear.
- Watch the numbers. `offAxisDeg` turns the readout (and the lip dots)
  green with an "OPTIMAL" tag once you're within 15 degrees, using the
  same 15/18 hysteresis band as before so it doesn't flicker at the
  boundary. This is guidance only, it does not gate the button.
- Tap **Capture** whenever you want a shot, angle notwithstanding. The
  app locks exposure/WB/focus at the *current* auto-computed values if
  the platform allows it (`src/capture/deviceCamera.ts` reads
  `track.getSettings()` before switching to manual, since switching
  without a value snaps some devices to a near-black default instead of
  preserving what the preview was showing), bursts 6 frames cropped to
  the tracked mouth bounding box (not the full frame), keeps the
  sharpest, burns the pose readout into it, and saves it. The button
  shows `...` while that's in flight (about 1.3s) and won't double-fire.
- The viewfinder keeps going after each shot. Shift your angle and tap
  again for another. Up to `MAX_SESSION_CAPTURES` (8, in
  `src/config.ts`) per sitting; the button reads "Full" once you hit
  that.
- Tap **Done** any time to open the gallery: a grid of everything saved
  this session and before. Tap a thumbnail for the full image, its pose
  metadata, a **Save to device** download, or **Delete**.
- All storage is `src/storage/captureStore.ts`, a thin IndexedDB
  wrapper. No network calls, no server. **Clear all** in the gallery
  wipes it.

Auto-triggered capture (hold-to-fire off the full 7-gate system) is
still in the codebase (`src/capture/captureController.ts`,
`src/gates/`, still unit tested) but not wired into the live view for
this preliminary release, the manual button read clearer and felt more
responsive in testing.

## Config decision open (handoff Section 10)

`CAPTURE_MODE` in `src/config.ts` is set to `'front'`. Both `'front'`
and `'rear'` paths are implemented (mirroring, direction prompts, and
facingMode all read from this one constant), but which one ships is
Michael's call: front enables unassisted patient self-capture, rear
gives materially better color data but needs a clinician or assistant
operating the phone.

## What's simplified

- **No Web Worker.** The tracker and gate evaluator run on the main
  thread, driven by `requestVideoFrameCallback`. The handoff calls for
  moving both into a worker to protect the 24fps target on mid-range
  Android; that move is straightforward (both layers are already pure
  and DOM-free) but not done here.
- **No live directional guidance right now.** `src/gates/directionPrompt.ts`
  (left/right/up/down prompts derived from `offAxisVec`) still exists and
  is unit-tested, but isn't wired into this preliminary manual-capture
  view, you read the raw numbers instead. Its sign convention is still
  unverified against a real tester either way (handoff Section 8).
- **Stability gate uses an approximation.** `TrackerResult.landmarkChecksum`
  is a scalar sum of lip landmark pixel coordinates, not full landmark
  positions, so "mean landmark movement in px" is estimated from its
  frame-to-frame delta rather than computed exactly. Documented in
  `src/gates/gateEvaluator.ts`. (Not used by the live view right now;
  still covered by its own unit tests.)
- **Full end-to-end capture is unverified in this environment.** No real
  camera/face was available to confirm the whole
  capture-to-burn-in-to-gallery pipeline on a live shot; it's covered by
  unit tests (gate hysteresis, capture-store round-trips) and a headless
  smoke test (app loads, tracker initializes, button reflects
  face-detected state), but not an actual photo.
- **Unit tests cover the gate evaluator's core behavior** (angle
  hysteresis boundaries at 15/18, prompt priority, the 800ms minimum
  display lock, capture triggering, roll hysteresis, distance copy) and
  the capture store (save/list/delete/clear round-trips) but not every
  gate's hysteresis band exhaustively.

## Architecture

Matches the handoff's three-layer split:

- `src/tracker/` — Layer 1. `MediaPipeTracker` is the only file that
  imports `@mediapipe/tasks-vision`; everything else only sees the
  `TrackerResult` interface in `src/tracker/types.ts`, so the engine can
  be swapped later without touching gates or UI.
- `src/gates/` — Layer 2. `evaluateGates` in `gateEvaluator.ts` is a
  pure function (no DOM access): same `TrackerResult` + exposure number
  + prior state in, same evaluation out. All tuning constants live in
  `src/config.ts`.
- `src/ui/` and `src/capture/` — Layer 3. Camera setup, canvas overlay,
  the burst/lock/score capture sequence (`src/capture/captureSequence.ts`),
  and screens. The auto-trigger hold/ring state machine
  (`src/capture/captureController.ts`) still exists but isn't wired into
  `main.ts` for this preliminary manual-capture release.

The MediaPipe model (`public/models/face_landmarker.task`) and WASM
runtime (`public/wasm/`) are bundled locally and precached by the
service worker, no CDN calls, works offline.
