# Gavan Guided Capture (v2)

A guided smile capture PWA per the [handoff spec](../). Live camera
viewfinder, a rectangle that tracks the mouth and turns green with an
"Optimal" label when the phone is within 15 degrees of square-on, and
automatic capture once the user holds a valid position. Built to feed a
shade-matching pipeline, so frames come straight off the raw camera
track, never from encoded video.

v2 adds on-device persistence: the viewfinder keeps capturing (instead
of stopping after one shot) so you can vary your angle within the valid
cone and build up a set of shots, each with the live pose readout
(`offAxisDeg` / `offAxisVec` / `rollDeg`) burned into the image itself.
Everything is saved locally via IndexedDB, a gallery screen lets you
review, save to device, or delete, and nothing is ever uploaded.

This is still a prototype: the core guided-capture loop works end to
end and is worth trying, but several items are deliberately simplified
or unverified. See "What's simplified" below before treating this as
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

## Verifying angle and direction on a real device

Before trusting the green/amber rectangle or the "move left/right"
prompts, open `/debug.html` on a phone and follow handoff Section 5's
steps: face the camera straight on, turn left and right, tilt the chin
up and down, tilt the head sideways. It prints `offAxisDeg`,
`offAxisVec`, and `rollDeg` live and draws dots on the 20 outer-lip
landmarks so you can also confirm they trace the lips. If a sign is
backwards, flip `X_SIGN` / `Y_SIGN` in `src/tracker/mediapipeTracker.ts`,
everything else reads from `offAxisVec`, nothing else needs to change.

## The v2 capture loop

- Hold the green "Optimal" box: after 5 held frames a ring fills, the
  app locks exposure/WB/focus if the platform allows it, bursts 6
  full-resolution frames, keeps the sharpest, and saves it.
- The viewfinder then keeps going. Shift your angle a bit (still inside
  the valid cone) and hold again for another shot. Up to
  `MAX_SESSION_CAPTURES` (8, in `src/config.ts`) per sitting.
- Tap **Done** any time to open the gallery: a grid of everything saved
  this session and before. Tap a thumbnail for the full image, its pose
  metadata, a **Save to device** download, or **Delete**.
- All storage is `src/storage/captureStore.ts`, a thin IndexedDB
  wrapper. No network calls, no server. **Clear all** in the gallery
  wipes it.

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
- **The repeat-capture trigger relies on a brief break in hold.** Since
  a continuous perfect hold only edge-triggers `captureTriggered` once,
  getting a second shot at a new angle currently requires the pose to
  drop out of all-pass for at least one frame in between (which happens
  naturally as you move to a new angle, but a deliberately smooth,
  continuous sweep might not trigger extra shots). Not verified on a
  real device.
- **Full end-to-end capture-triggering is unverified in this
  environment.** No real camera/face was available to confirm the whole
  hold-to-capture-to-gallery pipeline fires correctly; it's covered by
  unit tests (gate hysteresis, capture-store round-trips) and a headless
  smoke test (app loads, no console errors), but not a live capture.
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
  the capture-hold/ring/burst state machine
  (`src/capture/captureController.ts`), and screens.

The MediaPipe model (`public/models/face_landmarker.task`) and WASM
runtime (`public/wasm/`) are bundled locally and precached by the
service worker, no CDN calls, works offline.
