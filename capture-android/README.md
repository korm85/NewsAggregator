# Gavan Capture -- Native Android (Camera2)

A native Kotlin/Camera2 rewrite of `capture-pwa/`, built specifically to compare
against the PWA: same face-tracking model, same gate thresholds, same capture
flow -- but talking to the camera sensor directly instead of through a browser's
`getUserMedia` API. This exists to answer one question: **is the PWA a
downgrade?**

## What's "uplifted" here vs. the PWA

The PWA's `capture-pwa/src/capture/deviceCamera.ts` has to work within what a
browser exposes, which is a best-effort, capability-gated layer on top of the
real camera API:

- **Exposure lock**: the PWA reads whatever auto-exposure value the browser
  currently has (`track.getSettings()`), then tries to re-apply it as a
  `manual` constraint (`tryLockCapture` in `deviceCamera.ts`) -- gated on
  `MediaTrackCapabilities.exposureMode` even existing, which Safari doesn't
  expose at all. This app sets `CaptureRequest.CONTROL_AE_LOCK = true`
  directly on the sensor (`Camera2Controller.setAeLock`) -- an unconditional,
  always-available Camera2 request key, not a guess.
- **Resolution ceiling**: the PWA asks for `{ ideal: 3840x2160 }` and then
  re-queries `track.getCapabilities()` to try to hit the browser-negotiated
  max (`pickMaxResolutionConstraints`). This app reads
  `CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP` directly for the
  sensor's actual maximum JPEG output size -- no negotiation layer in between.
- **Manual controls in general**: focus distance, torch, white balance are all
  `MediaTrackConstraints` the PWA can only request and hope for; here they're
  direct `CaptureRequest` keys on `CameraDevice.TEMPLATE_PREVIEW`.

If the native build's captures look sharper, better-exposed, or more
consistent than the PWA's, this is why -- not a difference in the tracking
or gate logic, which is a deliberate 1:1 port (see below).

## What's a 1:1 port (not reimplemented, ported)

To keep the comparison meaningful, the following came from `capture-pwa/`
translated line-for-line, not redesigned:

- `src/config.ts` -> `config/Config.kt`: every threshold (pitch/yaw/roll
  bands, smile MAR/width, distance range, hold-frame count, countdown
  duration) is the same number.
- `src/gates/smartFrameEvaluator.ts` -> `gates/SmartFrameEvaluator.kt`: same
  hysteresis bands, same prompt-priority/minimum-display-duration logic, same
  hold-count-to-capture-trigger behavior.
- `src/gates/captureArmEvaluator.ts` -> `gates/CaptureArmEvaluator.kt`: the
  same self-timer "get ready" countdown state machine (arm -> count 3-2-1 ->
  fire, cancel-on-any-gate-failure).
- `src/gates/directionPrompt.ts` -> `gates/DirectionPrompt.kt`: same
  mirroring-aware left/right/up/down resolution.
- `src/tracker/mediapipeTracker.ts` -> `tracker/FaceLandmarkerTracker.kt`:
  same angle/MAR/smile-width-ratio math, same sign convention, against the
  **same model file** (`assets/models/face_landmarker.task` is byte-identical
  to the PWA's `public/models/face_landmarker.task`), via MediaPipe's official
  Android AAR instead of the wasm runtime.
- `src/capture/captureSequence.ts` -> `capture/CaptureSequence.kt`: same
  three-still-candidates-then-lock-then-sweep-video flow, same timing
  constants (120ms between stills, 500ms settle, 5s sweep).
- `src/storage/captureStore.ts` -> `storage/` (Room): same record shape,
  same "nothing leaves the device" property -- no network calls anywhere in
  this app.

Unit tests in `app/src/test/java/com/gavan/capture/gates/` are ported 1:1
from the PWA's vitest suites (`smartFrameEvaluator.test.ts`,
`captureArmEvaluator.test.ts`) -- same 29 test cases, same assertions,
translated to JUnit. Run them with `./gradlew testDebugUnitTest`.

## Known gap: ArUco shade-card detection

The PWA's `cardboardMode` (ArUco marker detection for the calibration card +
light-direction estimation, `cardDetector.ts` / `lightEstimator.ts`) is
**not ported**. It depends on a pure-JS ArUco library with no equivalent
already in this project's dependency graph, and pulling in a native
detector (OpenCV's ArUco module, or a pure-JVM alternative like BoofCV)
is a real scope decision, not a quick add. `cardboardMode` is wired to
always be `false` in this app -- the gate evaluator handles that correctly
(the `card` gate is a no-op when off, matching the PWA's own behavior with
the toggle off), so nothing is silently broken, but the calibration-card
workflow only exists in the PWA today. This is the one feature-parity gap;
everything else above is a full port.

## Building

Requires the Android SDK (`compileSdk 34`, `minSdk 26`) and a JDK 17+.

```bash
./gradlew testDebugUnitTest   # pure-logic gate tests, no device needed
./gradlew assembleDebug       # produces app/build/outputs/apk/debug/app-debug.apk
```

Install on a device/emulator with `adb install app-debug.apk`, or open the
`capture-android/` directory directly in Android Studio.

## What has NOT been verified

This was built and tested in a CI-style sandbox with **no physical Android
device or emulator available** -- everything above compiles and the pure gate
logic is unit-tested, but the following are unverified on real hardware and
should be treated as a first cut, not a finished product:

- Actual camera preview, capture, and video-recording behavior end-to-end.
- The MediaPipe Face Landmarker's live-stream detection against real camera
  frames (the YUV->Bitmap conversion path in `Camera2Controller.yuv420ToBitmap`
  in particular -- it's a standard NV21/JPEG round-trip, but unverified for
  correctness against actual sensor output on a specific device).
- Sensor orientation / mirroring correctness (`rotateAndMirror`) across
  different phone models -- `sensorOrientation` handling is implemented per
  the standard Camera2 pattern but not confirmed visually.
- UI layout on a real screen (touch targets, debug panel scroll behavior,
  countdown numeral placement).
- Battery/thermal behavior of running Camera2 + MediaPipe GPU delegate +
  MediaRecorder concurrently.

Treat the first real-device run as the actual start of testing, the same way
the PWA's own thresholds (documented throughout `config.ts`) were tuned only
after on-device feedback, not assumed correct from the start.
