# Gavan Guided Capture (preliminary)

A guided smile capture PWA for shade-matching workflows, video-first
data gathering: the live view is a "Smart Frame" that locks the starting
geometry strictly (pitch, yaw, roll, distance, and smile all gated, see
"Gates: pose, distance, and smile" below) before a ~5.5 second "Active
Sweep" capture window begins. That window's job is not to hold still --
it deliberately asks the user to slowly move the camera side-to-side, so
a full-frame video clip (the primary color-calibration artifact) samples
multiple reflection angles for an offline post-processor to extract
angular telemetry and remove glare from. Three uncompressed still
candidates are grabbed in rapid succession right at the instant the
window starts, before the sweep begins, as color anchors -- not a
competing source of truth for the video, but not a single unrecoverable
frame either; all three are kept, and the sharpest is auto-flagged
(see "Video-first capture: three still candidates, not a scored burst"
below).

Capture triggers two ways, switched via a **Manual** toggle (top-left,
default off = **Auto**):

- **Auto** (default): once every active gate has held passing
  simultaneously for a few consecutive frames, capture does **not**
  fire instantly -- a self-timer-style 3-2-1 "get ready" countdown
  starts first, canceling cleanly if the pose breaks before it
  completes (see "Get-ready countdown" below). The shutter button is
  inert in this mode -- there's nothing for a manual tap to add once
  the gates already require exactly what a manual tap would.
- **Manual**: gates become guidance only, same as earlier versions. The
  shutter button works any time a face is detected, regardless of gate
  state, fires instantly on tap (no countdown -- pressing the button is
  itself the "I'm ready" signal), for a tester who wants a sample
  despite an imperfect pose.

A compact numeric readout (pitch/yaw/roll/MAR/smile width, hold count)
sits below the prompt banner for anyone who wants the raw numbers
instead of just the outline color.

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
- **Manual** (top-left) switches between Auto and Manual capture
  triggering, see the intro above. Default: off (Auto).
- **Debug** (top-left) reveals a small panel with sliders that adjust
  the distance gate's target range and the get-ready countdown duration
  live (see "Gates: pose, distance, and smile" and "Get-ready
  countdown" below) without a redeploy -- a POC tuning tool, not meant
  to ship visible by default in a real product.
- Watch the Smart Frame outline and prompt banner. In Auto mode, once
  every active gate holds passing for `THRESHOLDS.holdFramesRequired`
  consecutive frames, a get-ready countdown starts (see "Get-ready
  countdown" below) -- capture does not fire until it completes, and
  moving out of pose cancels it. In Manual mode, tap **Capture** any
  time a face is detected, regardless of gate state, firing instantly
  with no countdown.
- Once capture actually starts (immediately after the countdown
  completes, or immediately on tap in Manual mode), it grabs **three**
  uncompressed still candidates -- cropped to the tracked mouth bounding
  box, pose/smile/card readout burned in, ~120ms apart (long enough to
  cover a typical blink) -- starting **immediately**, before anything
  else in that sequence runs, so the first reflects the exact frame at
  that instant rather than one from hundreds of ms later (see "Zero-lag
  still capture" below for why this ordering matters). All three are
  kept and each is scored, the sharpest auto-flagged as the default (see
  "Video-first capture" below). *Only after* all three grabs does it
  lock exposure/WB/focus at
  the *current* auto-computed values if the platform allows it
  (`src/capture/deviceCamera.ts` reads `track.getSettings()` before
  switching to manual, since switching without a value snaps some
  devices to a near-black default instead of preserving what the
  preview was showing), then records a full-frame video for the Active
  Sweep window and saves both with the full metadata set (see
  "Video-first capture" below). See "Capture feedback" below for what's
  on screen during this window.
- The viewfinder keeps going after each shot. Up to `MAX_SESSION_CAPTURES`
  (8, in `src/config.ts`) per sitting; the button reads "Full" once you
  hit that.
- **Gallery** (top-right) is always visible, not gated behind capturing
  something this session, tap it any time to open a polished grid of
  everything saved this session and before (see "Gallery" below for the
  redesign). Tap a thumbnail for the full image, the supplementary video
  when one was recorded, save/delete actions, and a collapsed **Capture
  details** section with the full metadata (pitch/yaw/roll, smile width,
  MAR, exposure lock, and, when captured with the card, marker/flatness
  status and light direction) for anyone who wants it.
- All storage is `src/storage/captureStore.ts`, a thin IndexedDB
  wrapper. No network calls, no server. **Clear all** in the gallery
  wipes it.

## Gates: pose, distance, and smile

`src/gates/smartFrameEvaluator.ts` gates on `face`, `pitch`, `yaw`,
`roll`, `distance`, and `smile` always (plus `card` in cardboard mode),
in that priority order for which failing gate's prompt shows. Roll and
distance were added to strictly lock the starting geometry before the
Active Sweep begins, on top of the pose/smile gates that already
existed:

- **`pitch`/`yaw`**: unchanged, `THRESHOLDS.pitch`/`THRESHOLDS.yaw`
  (15° enter / 18° exit, independent axes).
- **`roll`**: `THRESHOLDS.roll` (5° enter / 6° exit) -- this threshold
  already existed in config.ts from the older 7-gate system but was
  never wired into the Smart Frame evaluator; it's now the roll gate
  directly, unchanged.
- **`distance`**: mouth-box width as a fraction of frame width (no
  extra math needed, landmarks are already normalized 0-1). Default
  range `DISTANCE_GATE_DEFAULTS` in `config.ts`, `0.15`-`0.25`,
  approximating 15-25cm from camera to face for sharp optical focus --
  **an unverified starting estimate**, the same shape of guess that
  took two wrong tries before `smileWidth` was corrected with real
  data (see "Smile detection" below). Runtime-adjustable via the
  viewfinder's **Debug** panel specifically so it can be retuned on a
  real device without a redeploy; `evaluateSmartFrame` falls back to
  the config default when a caller doesn't supply its own
  `distanceRange` (every unit test included).
- **`smile`**: unchanged, see "Smile detection" below.

## Get-ready countdown: self-timer, not instant fire

On-device feedback: auto-capture firing the instant gates aligned felt
"unexpected and too aggressive" -- the entire gap between "pose happened
to align" and the shutter firing was `THRESHOLDS.holdFramesRequired`
frames, roughly **166ms** at ~30fps, with no perceptible warning. If the
pose only lined up for a fleeting instant while the user was still
adjusting (not actually ready), a bad capture fired anyway, and there
was no way to back out of it mid-flight.

Fixed by adopting a battle-tested camera pattern instead of inventing
one: **self-timer / photo-booth 3-2-1 countdown**, the same pattern
behind iOS Camera's timer, Photo Booth, and every "hold a pose" portrait
auto-capture feature. This fits specifically because the task is
"compose yourself, hold a pose, then fire" -- not an instant-recognition
task like a QR scanner, where waiting has no benefit because the target
is already static and final.

- **Arming** (unchanged): gates must hold passing for
  `holdFramesRequired` frames, same as before -- just a flicker-
  debounce, not itself a user-facing cue.
- **Counting down** (new, `src/gates/captureArmEvaluator.ts`): once
  armed, a large centered numeral appears (`.countdown-numeral` in
  `viewfinderScreen.ts`) and counts down over
  `CAPTURE_ARM_DEFAULTS.durationMs` (default 3000ms, one tick per
  second -- the standard shortest self-timer duration across mainstream
  camera apps). The prompt banner shows "Hold that pose..." for the
  duration, and each tick gets a short, distinct haptic pulse + tone
  (`fireTickHaptic`/`playTickSound` in `main.ts`, deliberately
  different from the final capture-confirm chime in
  `captureSequence.ts` so a tick doesn't sound like the shutter).
- **Cancel on movement**: if any gate fails at any point during the
  countdown, it cancels immediately -- no capture, no penalty, a smooth
  reset back to normal live guidance. This is the direct fix for "I can
  keep moving and auto capture will be shit": moving now cancels
  instead of forcing a bad shot. The cancellation rides on
  `evaluateSmartFrame`'s existing hold-count reset (any gate failing
  already resets `holdCount` to 0), so no duplicate gate-tracking state
  was needed in the new module.
- **Fire**: only once the full countdown completes with every gate still
  holding does capture actually start, otherwise unchanged from before.

The countdown numeral is a plain DOM element, not drawn on the tracking
overlay canvas: the canvas gets a CSS mirror transform in front-camera
mode, and while the existing direction-arrow logic correctly un-mirrors
*arrows*, a canvas-drawn digit like "2" would render as a backwards,
garbled glyph in that mirrored space rather than just repositioned -- a
bug worth avoiding by construction. No background fill behind the
numeral either, same "never cover the face" rule the rest of the
capture feedback already follows (see "Capture feedback" below) -- bold
text with a strong shadow carries contrast instead. The existing small
hold-progress ring (`drawRing` in `overlay.ts`) is suppressed (forced to
0, not removed) once the big numeral takes over, so the two don't
visually compete.

**The countdown duration is runtime-adjustable via the Debug panel**
(same slider pattern as the distance-gate range), not just a fixed
config guess -- 3000ms is a pattern-matched starting estimate, not yet
validated against this app's on-device feel, and there's no way to
determine the "right" duration without a real device, so a live dial
was shipped instead of a guessed number.

## Video-first capture: three still candidates, not a scored burst

Earlier versions sampled 15 raw canvas frames across the whole ~5s
capture window and kept whichever scored best on sharpness/clipping, on
the theory that the still image was the primary color-measurement
artifact and the video was purely supplementary. That's now inverted:
the downstream color calibration algorithm doesn't need a perfectly
glare-free still, it needs the **video** -- multiple reflection angles
from a deliberate camera sweep, which the offline post-processor uses
to extract angular telemetry (more accurately than the live browser
tracker could) and remove glare. So:

- The still image (`src/capture/captureSequence.ts`) is now
  **`CAPTURE_SEQUENCE.stillFrameCount` (3)** uncompressed canvas
  candidates, grabbed at the exact start of the capture window -- before
  the user begins sweeping, `stillFrameIntervalMs` (120ms) apart -- so
  they reflect the strictly-gated starting geometry, not scattered
  across the whole 5s window the way the old 15-frame burst was. All
  three are kept and scored (sharpness minus a clipping penalty,
  `frameScore.ts`); the sharpest is flagged as `bestStillIndex` and used
  as the default single image everywhere (thumbnail, download), but
  nothing is discarded -- the gallery lightbox shows all three so a
  bad instant (blink, motion blur, a stray highlight) has a fallback
  instead of ruining the only shot, without going back to a full
  15-frame scored burst. See "Zero-lag still capture" below for exactly
  what "the exact start" means, and why only the *first* of the three
  is truly zero-lag.
- `ImageCapture.takePhoto()` (the browser's dedicated photo pipeline,
  Chrome/Android only) is **bypassed entirely**, not just left as a
  fallback path. It applies its own hardware tone mapping that can't be
  undone, which is worse for a color-calibration anchor than the
  resolution it would have gained -- and removing it also deletes a
  whole conditional path (the old `stillSource: 'imageCapture' |
  'canvas'` field, and the untested question of whether the manual
  exposure lock survives into it).
- The supplementary video (`src/capture/videoRecorder.ts`) is now the
  primary artifact: recorded at as high a bitrate as `MediaRecorder`
  will take (`TARGET_VIDEO_BITRATE_BPS`, config.ts, an `ideal`-style
  hint the encoder clamps rather than errors on) to minimize
  compression artifacts in the specular-highlight detail glare-removal
  depends on. No highlight clipping or glare rejection is applied
  client-side -- every specular highlight is deliberately passed
  through to the saved video, unlike the still-image scoring above,
  which still penalizes clipping when picking the default still.
- The Active Sweep window itself (the video recording) is still ~5s
  (`CAPTURE_SEQUENCE.burstDurationMs`), just repurposed from the old
  15-frame burst interval to simply how long the video records while
  the user sweeps. The three still candidates add roughly
  `2 * stillFrameIntervalMs` (~240ms) up front, before the exposure
  lock/settle/video start -- small next to the 5s window, but real.
- The live MediaPipe tracking loop still pauses for the entire window
  (see "Capture feedback" below) -- nothing about that changed, video-
  first capture doesn't need live tracking data any more than the old
  approach did.

## Zero-lag still capture: grab first, lock and settle after

`runCaptureSequence()` originally locked exposure/WB/focus and then
`sleep`d for `sensorSettleMs` (500ms) *before* grabbing any still frame
-- inherited from the pre-video-first design, where the still was
chosen from a 15-frame burst that needed settled exposure across all of
it. Once the still became a small, fast set of anchor frames (see
"Video-first capture" above), that ordering was pure added latency with
no benefit: the saved pixels were being captured 500ms+ after the gates
actually went green, not at the moment they did.

Fixed by reordering: all three still candidates are now grabbed
**first**, with no `await` of any kind ahead of the first one, so the
earliest candidate's saved pixels are (as close as the browser's own
camera pipeline allows) the exact frame that satisfied the gates. The
second and third are `stillFrameIntervalMs` (120ms) apart from there --
a deliberate, small, *known* delay (to cover a blink), not an
accidental one. Exposure lock + settle moved to *after* all three
grabs, now positioned ahead of the video recording instead, where their
value -- keeping the sweep's multiple frames photometrically consistent
for the offline glare-removal step -- still applies. Concretely, all
three stills are captured under whatever auto-exposure/WB was live at
that moment, not a locked value; that's what the user watched go green,
so it's the right tradeoff for anchor frames that don't need
cross-frame consistency with the video the way the video's own frames
need consistency with each other.

What's left is the latency floor a browser doesn't expose control
over: the camera pipeline's own sensor-to-`<video>`-element delay, and
up to one frame's worth of `requestVideoFrameCallback` timing between
the tick that evaluated the gates and the tick this function actually
runs on (they're normally the same tick, since `performCapture()` calls
straight through to this function with no intervening `await`). Neither
has been measured on a real device -- unverified, same caveat as
everything else in this project.

## Capture feedback: visible countdown, never over the face

This is a **different** countdown from the get-ready one above: that
one runs *before* capture starts (big centered numeral, cancelable by
moving out of pose); this one runs *during* capture, once it's already
underway and can no longer be canceled -- the shutter button turning
red and ticking down while the still candidates and video are actually
being captured.

Sound/haptics alone (`fireHaptics`/`playCaptureSound` in
`captureSequence.ts`) were easy to miss, especially for auto-capture
where nothing else changes on screen. An earlier version covered the
whole 5.5-second capture window with a full-screen dimmed overlay card
(countdown + progress bar + guidance), but on-device that hid the very
face being captured for the entire window -- defeating the point of
live feedback in a smile-capture app. The fix: the countdown lives on
the shutter button itself, which is the one element guaranteed not to
sit over the live preview. The button turns red and counts down in
seconds (`startCaptureCountdown` in `src/main.ts`), then briefly flashes
green with "Saved" (`showCaptureSuccess`) before resetting. A single
static instruction, "Slowly move camera side-to-side"
(`ACTIVE_SWEEP_PROMPT`), goes into the existing small `.prompt-banner`
pill at the top of the screen for the entire window, instead of a
dedicated element or the rotating multi-step guidance earlier versions
used.

Unlike the earlier rotating guidance (deliberately small movements, so
as not to disturb a scored still-frame selection), this window now
*wants* real movement: the video, not the still, is the primary color-
calibration artifact (see "Video-first capture" above), and a real sweep
is what gives the offline post-processor multiple reflection angles to
work with. The timer/prompt loop runs independently of the actual
capture internals (`captureSequence.ts`), driven off the same
`CAPTURE_SEQUENCE` constants rather than a callback threaded through the
recording, so it's an approximate on-screen cue, not frame-exact sync
with what's actually happening at that instant.

The live MediaPipe tracking loop (`onFrame` in `src/main.ts`) also now
pauses -- skips detection, gate evaluation, and overlay redraw entirely
-- for the duration of an active capture, resuming the instant it ends.
This was a defensive fix for an on-device crash reported right as the
5-second capture window finished: with no crash log available to pin
down an exact cause, the working hypothesis is resource contention from
running the continuously-active GPU-delegated face tracker at the same
time as the max-resolution `MediaRecorder`, the 15-frame canvas burst,
and (on Chrome/Android) `ImageCapture` all at once. None of that
in-flight tracking work is actually used during a capture anyway (the
trigger, if any, already fired), so pausing it costs nothing and
meaningfully cuts concurrent load during the heaviest few seconds. If
the crash recurs, the next step would be an actual browser console
error or crash report to confirm the real cause rather than this
resource-reduction hypothesis.

## Gallery: polished, metadata tucked away

The lightbox used to put a full raw-metadata panel (pitch/yaw/roll, MAR,
mouth box percentages, etc.) directly under the image, unavoidable and
fairly technical-looking for a review screen. Redesigned
(`src/ui/galleryScreen.ts`): the grid thumbnails no longer carry a raw
angle badge (a small video icon is the only overlay, and only when a
clip was recorded, plus a small count badge when more than one still
candidate was saved); the lightbox leads with the image/video, a clean
date/time subtitle, and Save/Delete actions, then all 8+ metadata fields
live inside a collapsed `<details>` "Capture details" disclosure, opt-in
for anyone who wants the numbers rather than always in front. A close
button in the corner replaces the old bottom "Close" button, and the
lightbox itself scrolls (`overflow-y: auto`) instead of risking overflow
on a small screen now that it can hold an image, a still-candidates
strip, a video, and a disclosure panel.

Below the main image, a horizontally-scrolling strip shows every still
candidate captured (see "Video-first capture" above), the sharpest
outlined green and badged "Best". Tapping a candidate swaps the main
preview so any of them can be inspected full-size; Save/Delete always
act on the auto-picked best regardless of which candidate is being
previewed, so what actually leaves the device on "Save to device" stays
unambiguous even while browsing alternates. Nothing about a candidate
can currently be "promoted" to replace the auto-pick -- if the sharpest
one isn't the one someone actually wants, there's no in-app way to
change which blob is `StoredCapture.blob` short of deleting the whole
capture and retaking it. Worth a follow-up if manual override turns out
to matter in practice.

The older 7-gate system (`gateEvaluator.ts`, `captureController.ts`,
`gates/types.ts`, `capture/exposureSample.ts`) predated the Smart Frame
spec, was already unwired from `main.ts`, and has now been deleted
outright rather than kept around unused -- `distance` and `roll` from
that system's threshold set were reused (moved into
`smartFrameEvaluator.ts` directly, see "Gates: pose, distance, and
smile" above), everything else about it is gone for good.

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

## Video capture: the primary artifact, full-frame

The spec calls for "automatic initiation of video recording ... a five
second video to manage reflections" -- under the video-first design (see
"Video-first capture" above) this is no longer a supplementary nice-to-
have, it's the main color-calibration data source.
`src/capture/videoRecorder.ts` records a real `MediaRecorder` clip
(`.webm`, mimeType feature-detected, bitrate maximized via
`TARGET_VIDEO_BITRATE_BPS`) across the Active Sweep window, saved
alongside the still-image anchor in every `StoredCapture` (`videoBlob`/
`videoMimeType`/`videoDurationMs`).

The video is recorded **full-frame**, not cropped to the mouth like the
still image, and shown full-frame in the gallery too, no cropping there
either. Recording the raw track directly is just `MediaRecorder(track)`,
no extra work; a cropped version would need continuously redrawing the
live frame to a canvas for the full window to feed the recorder, real
per-frame cost stacked on top of the tracker and gate evaluator already
running every frame, for a cosmetic detail. Not worth it.

A recording failure of any kind (unsupported browser, constructor
throw, mid-recording error) degrades to `videoBlob: null` and never
affects the still-image capture path.

## Camera quality: resolution/frame-rate negotiation (Android + iOS)

`src/capture/deviceCamera.ts` (`maximizeResolution`/
`pickMaxResolutionConstraints`): after the camera starts, read the
negotiated track's own reported `getCapabilities().width/height.max`
and request exactly that, instead of relying solely on the static
`ideal: 3840/2160` hint some browsers under-honor. Uses `ideal`, never
`exact`, so it can't fail outright on a device that can't hit its own
reported max. No platform gap, no timing risk, works identically on
Android and iOS. Requests `frameRate: { ideal: 30 }` in the same call
(and in the initial `getUserMedia` constraints): confirmed on-device
that maximizing resolution alone visibly tanked the recorded video's
frame rate, because a phone camera's literal max resolution is often a
photo-capture mode the hardware only supports at 10-15fps, not a video
mode. `ideal` constraints are weighted preferences the browser balances
against each other, so asking for both lets it trade down resolution
slightly if that's what a usable frame rate actually costs, instead of
chasing resolution regardless.

`ImageCapture` (the browser's dedicated photo pipeline, Chrome/Android
only) was previously used here as a progressive-enhancement hero-shot
path. It has been **removed entirely**, not just left unused: see
"Video-first capture" above for why (irreversible hardware tone mapping
is a worse tradeoff for a color-calibration anchor than the resolution
gain). `src/capture/imageCapture.ts` no longer exists.

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
- **Distance gate range is a placeholder.** `DISTANCE_GATE_DEFAULTS`
  (0.15-0.25) approximates 15-25cm but isn't calibrated against real
  captures -- runtime-adjustable via the Debug panel for exactly this
  reason. See "Gates: pose, distance, and smile" above.
- **Get-ready countdown duration is a placeholder.**
  `CAPTURE_ARM_DEFAULTS.durationMs` (3000ms) is a pattern-matched
  guess (the standard shortest self-timer duration across mainstream
  camera apps), not validated against this app's on-device feel --
  same reason it's runtime-adjustable via the Debug panel rather than
  presented as settled. Whether `holdFramesRequired` (still 5 frames,
  now just the *entry* gate into this longer sequence) needs bumping
  for stability is also unverified. See "Get-ready countdown" above.
- **Resolved (partially): the still-image anchor has fallback frames
  again.** A single-frame-at-window-start design (no scoring, no
  fallback) briefly replaced the old best-of-15 approach as part of the
  video-first pivot, then was revised again to grab 3 candidates
  (`stillFrameCount`) 120ms apart instead of just 1 -- specifically to
  cover a blink -- with all 3 kept and the sharpest auto-flagged. This
  is real insurance, but weaker than the old 15-frame version across a
  full 5s window: 3 frames spanning ~240ms only protects against a
  brief bad instant near the trigger, not drift or a longer blink later
  in the window (which the still doesn't sample at all -- only the
  video covers the full window now).
- **No Web Worker.** The tracker and gate evaluator run on the main
  thread, driven by `requestVideoFrameCallback`. Both layers are already
  pure and DOM-free, so moving them into a worker is straightforward but
  not done here.
- **Video storage size isn't managed, and just got bigger.** A 5-second
  full-frame clip was already materially larger than the cropped-mouth
  JPEG anchor; maximizing the recording bitrate (see "Video-first
  capture" above) makes each clip larger still, on purpose (compression
  artifacts in specular-highlight detail were the concern, not storage
  budget). At `MAX_SESSION_CAPTURES = 8` per sitting this adds real
  IndexedDB growth per session. No quota handling
  (`navigator.storage.estimate()`, etc.) implemented, flagged as a real
  follow-up, not solved here.
- **Video recording is unverified on real hardware, more so now.**
  Covered by a round-trip storage test (`captureStore.test.ts`) and the
  fact that the code path degrades to `null` on any failure, but actual
  encode correctness at the new higher bitrate, whether the higher
  bitrate causes frame drops or dropped chunks on lower-end phones, and
  iOS Safari's `MediaRecorder` support specifics in practice are all
  real-device-only questions -- more so than before this change, since a
  higher bitrate is a heavier ask of the encoder. One real issue
  already found and fixed this way in an earlier round: maximizing
  resolution (see "Camera quality" above) without also asking for a
  frame rate visibly tanked the recorded video's fps. Not re-verified
  on a real device since either that fix or this one.
- **Whether the offline post-processor's actual input expectations
  match what's produced here is an assumption, not a verified
  contract.** Nothing in this repo defines what bitrate, container
  format (`.webm`/VP9 today, feature-detected), frame rate, or sweep
  speed the backend angle-extraction/glare-removal step actually wants
  -- `TARGET_VIDEO_BITRATE_BPS` and the sweep prompt's wording are both
  reasonable guesses, not confirmed against that system.
- **The Active Sweep countdown timing is an approximation, not
  frame-exact.** It runs off a local timer matched to
  `CAPTURE_SEQUENCE`'s configured durations, not a callback from the
  actual recording, so on a real device where per-frame processing
  (MediaPipe, canvas encode) adds overhead, the on-screen countdown
  could drift slightly from when the capture sequence actually
  finishes. It's a UX cue, not a synchronization guarantee.
- **The Manual/Auto toggle, Debug panel, and get-ready countdown are
  unverified visually on a real device.** Confirmed via the fake-camera
  smoke test that nothing throws and the new elements render/toggle
  (including the countdown-duration slider), but the fake camera never
  reports a detected face, so no gate ever passes and the countdown
  itself never actually runs in that test -- only its static wiring is
  checked. Real-device unknowns: look/feel, touch target sizing,
  whether the now-five-wide `.top-bar-left` cluster wraps sensibly on a
  small phone screen, whether the countdown numeral's size/position/
  contrast reads well against a live selfie feed in varying light,
  and whether the tick tone/haptic is perceptible without being
  annoying.
- **Without-cardboard capture is now confirmed working on a real
  device** (live view, pose readout, smile detection all exercised
  against real photos), which is how the smile-metric and direction-
  arrow issues above were actually found. The with-cardboard path
  (real ArUco marker detection, light estimation) is still unverified
  against a real camera/card in this dev environment, only against unit
  tests and a headless smoke test that confirms the toggle doesn't crash
  the loop, not detection accuracy. **Neither path has been re-verified
  against the new roll/distance gates or the Active Sweep capture flow**
  -- both are new since the last real-device round.
- **Unit tests cover gate evaluator behavior** (pitch/yaw/roll
  hysteresis boundaries, the distance gate's runtime-adjustable range
  and hysteresis buffer, the smile gate's MAR-floor and width-ratio
  hysteresis, the cardboard toggle's effect on which gates count,
  capture triggering, prompt priority and the 800ms minimum display
  lock) but not every hysteresis band exhaustively, and not ArUco
  detection accuracy itself (that's the vendored library's concern, not
  this codebase's). The get-ready countdown's own state machine
  (`src/gates/captureArmEvaluator.ts`) has separate unit test coverage
  (arm on the hold-reached edge, tick-boundary correctness, fire-exactly-
  once, cancel-on-any-gate-failure including one frame before
  completion, re-arm-restarts-from-the-top, and a live `durationMs`
  change mid-countdown not crashing) -- the state-machine logic is
  real-tested, only the *feel* of the chosen defaults is not.

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
  `evaluateCaptureArm` in `captureArmEvaluator.ts` is a second, sibling
  pure function sitting downstream of it -- consumes `captureTriggered`/
  `allPassed` each frame to run the get-ready countdown state machine
  (idle/counting/fire/cancel), kept separate so `evaluateSmartFrame`
  itself stays timing-agnostic. All tuning constants live in
  `src/config.ts`.
- `src/ui/` and `src/capture/` — Layer 3. Camera setup
  (`src/capture/deviceCamera.ts`, including the max-resolution
  negotiation), canvas overlay (Smart Frame outline + card guide,
  `src/ui/overlay.ts`), card detection (`src/capture/cardDetector.ts`)
  and light estimation (`src/capture/lightEstimator.ts`), the
  lock/anchor-frame/sweep capture sequence
  (`src/capture/captureSequence.ts`, which also drives the
  now-primary video recording via `src/capture/videoRecorder.ts`), and
  screens.

The MediaPipe model (`public/models/face_landmarker.task`), WASM runtime
(`public/wasm/`), and vendored ArUco library (`public/vendor/js-aruco2/`)
are all bundled locally and precached by the service worker, no CDN
calls, works offline.
