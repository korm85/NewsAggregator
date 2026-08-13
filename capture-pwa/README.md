# Gavan Guided Capture (v1)

A guided smile capture PWA per the [handoff spec](../). Live camera
viewfinder, a rectangle that tracks the mouth and turns green when the
phone is within 15 degrees of square-on, and automatic capture once the
user holds a valid position. Built to feed a shade-matching pipeline, so
frames come straight off the raw camera track, never from encoded video.

This is a v1 prototype: the core guided-capture loop works end to end
and is worth trying, but several items are deliberately simplified or
unverified. See "What's simplified in v1" below before treating this as
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
npm test          # gate evaluator unit tests (vitest)
npm run build     # typecheck + production build + service worker
npm run preview   # serve the production build locally
```

Two smoke-test scripts exercise the built app in headless Chromium with
a fake camera device (useful after any change, no real hardware needed):

```bash
node scripts/smoke-test.mjs     # permission -> viewfinder -> debug page, no console errors
node scripts/offline-test.mjs   # confirms the app (incl. camera + model) loads with network off
```

## Verifying angle and direction on a real device

Before trusting the green/amber rectangle or the "move left/right"
prompts, open `/debug.html` on a phone and follow handoff Section 5's
steps: face the camera straight on, turn left and right, tilt the chin
up and down, tilt the head sideways. It prints `offAxisDeg`,
`offAxisVec`, and `rollDeg` live and draws dots on the 20 outer-lip
landmarks so you can also confirm they trace the lips. If a sign is
backwards, flip `X_SIGN` / `Y_SIGN` in `src/tracker/mediapipeTracker.ts`,
everything else reads from `offAxisVec`, nothing else needs to change.

## Config decision open (handoff Section 10)

`CAPTURE_MODE` in `src/config.ts` is set to `'front'`. Both `'front'`
and `'rear'` paths are implemented (mirroring, direction prompts, and
facingMode all read from this one constant), but which one ships is
Michael's call: front enables unassisted patient self-capture, rear
gives materially better color data but needs a clinician or assistant
operating the phone.

## What's simplified in v1

- **No Web Worker.** The tracker and gate evaluator run on the main
  thread, driven by `requestVideoFrameCallback`. The handoff calls for
  moving both into a worker to protect the 24fps target on mid-range
  Android; that move is straightforward (both layers are already pure
  and DOM-free) but not done here.
- **Direction prompt sign convention is unverified.** The left/right/up/down
  mapping in `src/gates/directionPrompt.ts` is implemented and internally
  consistent, but the handoff explicitly calls for confirming it with a
  real tester who hasn't seen the code (Section 8). Use `/debug.html` on
  a real device first.
- **Stability gate uses an approximation.** `TrackerResult.landmarkChecksum`
  is a scalar sum of lip landmark pixel coordinates, not full landmark
  positions, so "mean landmark movement in px" is estimated from its
  frame-to-frame delta rather than computed exactly. Documented in
  `src/gates/gateEvaluator.ts`.
- **No images are persisted.** A capture result lives in memory for the
  current session (shown on the result screen with a "Save photo"
  download link the user can trigger themselves). Nothing is written to
  disk, IndexedDB, or a server. Wiring this into the actual
  shade-matching pipeline is out of scope for this v1.
- **Unit tests cover the gate evaluator's core behavior** (angle
  hysteresis boundaries at 15/18, prompt priority, the 800ms minimum
  display lock, capture triggering, roll hysteresis, distance copy) but
  not every gate's hysteresis band exhaustively.

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
  the capture-hold/ring/burst state machine
  (`src/capture/captureController.ts`), and screens.

The MediaPipe model (`public/models/face_landmarker.task`) and WASM
runtime (`public/wasm/`) are bundled locally and precached by the
service worker, no CDN calls, works offline.
