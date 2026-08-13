# Gavan Guided Capture (preliminary)

A guided smile capture PWA for shade-matching workflows. The live view is
a "Smart Frame": a color-coded outline around the tracked mouth region
(green once every active gate passes, amber otherwise) plus a prompt
banner telling the clinician what to fix, and a compact numeric readout
(pitch/yaw/roll/MAR/smile width) for anyone who wants the raw numbers
instead of just the color. Capture is both automatic (fires once every
gate has held passing for a few consecutive frames) and manual (a
shutter button that works any time a face is detected, angle
notwithstanding). Capture itself is a ~5.5 second guided sequence, not a
silent wait: a full-screen overlay shows a countdown, a progress bar, and
rotating guidance ("slowly tilt left... now center... slowly tilt
right") to vary the angle slightly during the window, ending in a clear
"Captured" state (see "Capture feedback" below). The still image comes
straight off the raw camera track, never from encoded video, cropped to
the mouth bounding box, with the pose/smile/card readout burned in; a
supplementary full-frame video clip is recorded alongside every capture
too (see "Video capture" below).

A **Cardboard** toggle (top-left) switches the guidance between two
modes:

- **Without cardboard**: the Smart Frame gates on head pose (pitch/yaw,
  each independently within 15 degrees) and smile width, so a closed or
  narrow smile doesn't pass as "smiling" (see "Smile detection: two
  metrics, not one MAR" below for why it's not just MAR).
- **With cardboard**: adds a dashed guide area below the mouth showing
  where to hold the calibration card, and a gate requiring all of its
  ArUco fiducial markers to be visible and the card held flat (checked
  via the marker quad's diagonal ratio). The system also estimates the
  light source direction from a specular highlight on the card, stored
  alongside the image as auxiliary color-accuracy data. The saved crop
  expands to include this card region, not just the mouth, so the photo
  itself actually shows the card.

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

**Left/right direction arrow: under re-investigation, not re-flipped
blindly a second time.** It was reported wrong on-device once, fixed by
flipping `X_SIGN` from `1` to `-1`, then reported wrong again after that
fix shipped. Flipping the sign a third time on another unverified guess
isn't a real fix, it's a coin flip. A mirrored front-camera preview is
supposed to behave like a real mirror (turning your own head to your own
left should turn your reflection toward the left side of the screen too,
mirrors don't swap left/right the way people assume, they swap front/
back), and by that logic the current (`X_SIGN = -1`) behavior looks
correct on the one photo available. The test that actually settles it:
face the camera straight on, slowly turn your chin toward your own left
shoulder (a physical action, no mirror interpretation needed), and read
whether the arrow says "left" or "right" *at that moment*. If it says
"right", the sign needs to flip back; if "left", it's correct and the
first report was likely a mix-up mid-test. Whoever runs this test next,
record the raw `yawDeg` sign at the same moment too, it's the ground
truth `X_SIGN` is supposed to track.

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
  readout into it, and saves it with the full metadata set. A real video
  clip records concurrently (see "Video capture" below). See "Capture
  feedback" below for what's on screen during this window.
- The viewfinder keeps going after each shot. Up to `MAX_SESSION_CAPTURES`
  (8, in `src/config.ts`) per sitting; the button reads "Full" once you
  hit that.
- **Gallery** (top-right) is always visible, not gated behind capturing
  something this session, tap it any time to open a polished grid of
  everything saved this session and before (see "Gallery" below for the
  redesign). Tap a thumbnail for the full image, the supplementary video
  when one was recorded, save/delete actions, and a collapsed **Capture
  details** section with the full metadata (pitch/yaw/roll, smile width,
  MAR, exposure lock, image source, and, when captured with the card,
  marker/flatness status and light direction) for anyone who wants it.
- All storage is `src/storage/captureStore.ts`, a thin IndexedDB
  wrapper. No network calls, no server. **Clear all** in the gallery
  wipes it.

## Capture feedback: a guided window, not a silent wait

Sound/haptics alone (`fireHaptics`/`playCaptureSound` in
`captureSequence.ts`) were easy to miss, especially for auto-capture
where nothing else changes on screen, and a brief end-of-capture flash
wasn't obvious enough either (`src/main.ts`, superseded now). The
5.5-second capture window (`sensorSettleMs` + `burstDurationMs`) now
shows a full-screen overlay the whole time: a countdown, a progress bar,
and guidance text that rotates through a few small-movement prompts
("hold still, locking focus" -> "slowly tilt left" -> "now center" ->
"slowly tilt right" -> "hold center, almost done"), ending in an
unmissable checkmark + "Captured" state held for ~900ms.

The guidance is deliberately *small* movements, not a full head turn or
walking the phone around: the still image is still picked from whichever
burst frame scores best on sharpness/clipping, so swinging through a
wide angle range would just make more of the burst land outside the pose
gate the auto-trigger already required. The point is catching a few
different specular-highlight angles during the window (the spec's
"manage reflections"), not re-posing the shot. The timer/guidance loop in
`src/main.ts` (`startCapturingOverlay`) runs independently of the actual
capture internals (`captureSequence.ts`), driven off the same
`CAPTURE_SEQUENCE` constants rather than a callback threaded through the
burst loop, so it's an approximate on-screen cue, not frame-exact sync
with what's actually being sampled at that instant.

## Gallery: polished, metadata tucked away

The lightbox used to put a full raw-metadata panel (pitch/yaw/roll, MAR,
mouth box percentages, etc.) directly under the image, unavoidable and
fairly technical-looking for a review screen. Redesigned
(`src/ui/galleryScreen.ts`): the grid thumbnails no longer carry a raw
angle badge (a small video icon is the only overlay, and only when a
clip was recorded); the lightbox leads with the image/video, a clean
date/time subtitle, and Save/Delete actions, then all 8+ metadata fields
live inside a collapsed `<details>` "Capture details" disclosure, opt-in
for anyone who wants the numbers rather than always in front. A close
button in the corner replaces the old bottom "Close" button, and the
lightbox itself scrolls (`overflow-y: auto`) instead of risking overflow
on a small screen now that it can hold an image, a video, and a
disclosure panel.

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

## Smile detection: two metrics, not one MAR

Confirmed on-device with two reference photos: a mouth-agape expression
scored `mar 0.784`, and a normal wide smile with the teeth rows close
together (clearly showing teeth, expected to pass) scored `mar 0.248`.
Both are legitimate "smiling wide enough to show teeth" shots, but a
single MAR (Mouth Aspect Ratio = vertical lip gap / mouth width) gate
can't tell them apart from a closed smile, because MAR is the classical
metric for detecting mouth *opening* (yawns, blinks-adjacent), not smile
*width*. That was the actual bug, not just a miscalibrated number.

Fixed by splitting into two metrics (`src/tracker/mediapipeTracker.ts`):

- `mar` — kept, but demoted to a low floor (`THRESHOLDS.smileMar`,
  0.08 enter / 0.05 exit) that only rules out a literally closed mouth.
- `smileWidthRatio` — new: mouth width / interocular distance (outer eye
  corners), a stable per-face scale reference. This is the actual
  "smiling wide" signal (`THRESHOLDS.smileWidth`), closer to the AU12/
  zygomaticus-pull family of smile detectors. Both metrics have to pass
  for the Smart Frame's `smile` gate.

`THRESHOLDS.smileWidth` went through three values before landing on real
data. `1.2 enter / 1.05 exit`, then `1.0 enter / 0.9 exit`, both guessed
assuming a wide smile scores above 1.0 on this ratio — wrong both times,
confirmed on-device that neither ever passed even with an exaggerated
smile. A real burned-in sample settled it: a deliberately maximal smile
(mouth wide open, teeth fully bared top and bottom; pitchDeg 10.58, yawDeg
0.44, rollDeg -2.80, mar 0.422) scored `smileWidth: 0.71`. Mouth width is
naturally less than interocular distance for most faces even smiling
hard, so the whole magnitude assumption was off, not just the exact
number. Current value is `0.55 enter / 0.45 exit` — real headroom below
that confirmed sample (it was an intentionally extreme test case, not the
bar every capture needs to clear). Anchored to one real data point, not a
calibration set across face shapes, so still expect further tuning, but
this should actually pass on the next real test unlike the prior two
guesses.

## Video capture: full-frame, alongside the still image, not instead of it

The spec calls for "automatic initiation of video recording ... a five
second video to manage reflections" in addition to the image
("stores the image or video file"). `src/capture/videoRecorder.ts`
records a real `MediaRecorder` clip (`.webm`, mimeType feature-detected)
concurrently with the existing raw-frame burst, same 5-second window,
saved alongside the still image in every `StoredCapture` (`videoBlob`/
`videoMimeType`/`videoDurationMs`). It is purely supplementary: the
still image (raw canvas frames, never encoded) remains the only source
used for color/shade measurement, per the original handoff constraint
on why measurement frames are never sourced from encoded video (lossy
compression can shift color).

The video is recorded **full-frame**, not cropped to the mouth like the
still image, and shown full-frame in the gallery too, no cropping there
either. Recording the raw track directly is just `MediaRecorder(track)`,
no extra work; a cropped version would need continuously redrawing the
live frame to a canvas for the full 5 seconds to feed the recorder,
real per-frame cost stacked on top of the tracker and gate evaluator
already running every frame, for a cosmetic detail. Not worth it.

A recording failure of any kind (unsupported browser, constructor
throw, mid-recording error) degrades to `videoBlob: null` and never
affects the still-image capture path.

## Camera quality: cross-platform approach (Android + iOS)

Needed to work well on both platforms, which ruled out the biggest
single lever (`ImageCapture`, Chrome/Android only, unsupported on
Safari/iOS entirely) as a full replacement for the capture pipeline.
Two-layer approach instead:

- **Baseline, both platforms** (`src/capture/deviceCamera.ts`,
  `maximizeResolution`/`pickMaxResolutionConstraints`): after the
  camera starts, read the negotiated track's own reported
  `getCapabilities().width/height.max` and request exactly that,
  instead of relying solely on the static `ideal: 3840/2160` hint some
  browsers under-honor. Uses `ideal`, never `exact`, so it can't fail
  outright on a device that can't hit its own reported max. No platform
  gap, no timing risk.
- **Progressive enhancement, Android/Chrome only**
  (`src/capture/imageCapture.ts`, `takeHighResPhoto`): after the
  existing burst-and-score loop has already picked its best moment
  (untouched, zero added latency to that timing-sensitive logic),
  attempt one `ImageCapture.takePhoto()` call for a full sensor-
  resolution photo. On success it replaces the scored canvas frame as
  the saved still (cropped to the same mouth region via
  `cropAndOverlayBlob` in `frameScore.ts`, so behavior stays consistent
  regardless of which pipeline produced it); on any failure, including
  simply being unsupported (all of iOS/Safari today, and the Playwright
  fake camera device), it falls back to the existing canvas frame
  exactly as before. Which path produced a given capture is recorded as
  `stillSource: 'imageCapture' | 'canvas'`, shown in the gallery.

A full replacement of the burst with `ImageCapture` calls (every one of
the 15 samples becoming a real photo capture) was considered and
rejected: each call likely has real shutter/processing latency that
doesn't fit the current ~333ms-per-frame budget, and it would still
leave iOS on today's behavior while adding real risk to the working
reflection-scanning logic on Android. The hero-shot approach above gets
the quality win where it's available without touching that logic at
all.

Whether `tryLockCapture()`'s manual exposure/white-balance lock
(`deviceCamera.ts`) carries over to `ImageCapture.takePhoto()`, or
whether the photo pipeline can silently override it, is untested and
device-dependent — flagged, not assumed either way.

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
- **Smile width threshold is a placeholder.** See "Smile detection: two
  metrics, not one MAR" above.
- **Roll (sideways head tilt) isn't gated in the Smart Frame.** The spec
  only calls out pitch/yaw thresholds, so that's what's gated; `rollDeg`
  is still tracked and shown in the readout/burned overlay but doesn't
  block auto-capture or turn the frame amber. The older 7-gate system
  did gate roll (max 5/6 degrees) for the same shade-matching reason a
  tilted head could distort color/geometry measurement. Worth confirming
  whether that was intentionally dropped or just not carried over when
  the spec's gate set replaced the old one, this wasn't asked about
  explicitly.
- **No Web Worker.** The tracker and gate evaluator run on the main
  thread, driven by `requestVideoFrameCallback`. Both layers are already
  pure and DOM-free, so moving them into a worker is straightforward but
  not done here.
- **Video storage size isn't managed.** A 5-second full-frame clip is
  materially larger than the existing cropped-mouth JPEG; at
  `MAX_SESSION_CAPTURES = 8` per sitting this adds real IndexedDB growth
  per session. No quota handling (`navigator.storage.estimate()`, etc.)
  implemented, flagged as a real follow-up, not solved here.
- **Video recording is unverified on real hardware.** Covered by a
  round-trip storage test (`captureStore.test.ts`) and the fact that the
  code path degrades to `null` on any failure, but actual encode
  correctness, whether running the recorder concurrently with the
  canvas burst loop causes frame drops on lower-end phones, and iOS
  Safari's `MediaRecorder` support specifics in practice are all
  real-device-only questions.
- **`ImageCapture` quality gain is unverified.** No real Android device
  was available to confirm `takeHighResPhoto()` actually produces a
  meaningfully higher-resolution/quality result than the canvas
  fallback, or how it behaves under real lighting/motion. The fallback
  path (used on every platform without it) is exercised by the existing
  smoke test; the enhancement path itself isn't.
- **Capturing-overlay timing is an approximation, not frame-exact.** It
  runs off a local timer matched to `CAPTURE_SEQUENCE`'s configured
  durations, not a callback from the actual burst loop, so on a real
  device where per-frame processing (MediaPipe, canvas encode) adds
  overhead, the on-screen countdown could drift slightly from when the
  capture sequence actually finishes. It's a UX cue, not a
  synchronization guarantee.
- **The gallery redesign and capturing overlay are unverified visually
  on a real device.** Confirmed via the fake-camera smoke test that
  nothing throws and the new elements render, but actual look/feel
  (spacing, the `<details>` disclosure, the overlay's readability in
  bright light) needs real-device eyes, same as every other UI change
  in this project.
- **Without-cardboard capture is now confirmed working on a real
  device** (live view, pose readout, smile detection all exercised
  against real photos), which is how the smile-metric and direction-
  arrow issues above were actually found. The with-cardboard path
  (real ArUco marker detection, light estimation) is still unverified
  against a real camera/card in this dev environment, only against unit
  tests and a headless smoke test that confirms the toggle doesn't crash
  the loop, not detection accuracy.
- **Unit tests cover gate evaluator behavior** (pitch/yaw hysteresis
  boundaries at 15/18, the smile gate's MAR-floor and width-ratio
  hysteresis, the cardboard toggle's effect on which gates count,
  capture triggering, prompt priority and the 800ms minimum display
  lock) but not every hysteresis band exhaustively, and not ArUco
  detection accuracy itself (that's the vendored library's concern, not
  this codebase's).

## Architecture

Three-layer split:

- `src/tracker/` — Layer 1. `MediaPipeTracker` is the only file that
  imports `@mediapipe/tasks-vision`; everything else only sees the
  `TrackerResult` interface in `src/tracker/types.ts` (now including
  `pitchDeg`/`yawDeg`/`mar`/`smileWidthRatio` alongside the original
  angle/roll fields), so the engine can be swapped later without
  touching gates or UI.
- `src/gates/` — Layer 2. `evaluateSmartFrame` in `smartFrameEvaluator.ts`
  is a pure function (no DOM access): same tracker result + card
  detection + cardboard-mode flag + prior state in, same evaluation out.
  All tuning constants live in `src/config.ts`.
- `src/ui/` and `src/capture/` — Layer 3. Camera setup
  (`src/capture/deviceCamera.ts`, including the max-resolution
  negotiation), canvas overlay (Smart Frame outline + card guide,
  `src/ui/overlay.ts`), card detection (`src/capture/cardDetector.ts`)
  and light estimation (`src/capture/lightEstimator.ts`), the
  burst/lock/score capture sequence (`src/capture/captureSequence.ts`,
  which also drives the supplementary video recording via
  `src/capture/videoRecorder.ts` and the optional high-res still via
  `src/capture/imageCapture.ts`), and screens.

The MediaPipe model (`public/models/face_landmarker.task`), WASM runtime
(`public/wasm/`), and vendored ArUco library (`public/vendor/js-aruco2/`)
are all bundled locally and precached by the service worker, no CDN
calls, works offline.
