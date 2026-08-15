# Gavan Capture -- Native Android (CameraX / Camera2)

A native Kotlin capture app built directly on **CameraX** -- Google's official
wrapper *on top of* Camera2, not a lesser or web-ish substitute for it -- built
specifically to compare against `capture-pwa/`: same face-tracking model, same
gate thresholds, same capture flow, but talking to the camera sensor directly
instead of through a browser's `getUserMedia` API. This exists to answer one
question: **is the PWA a downgrade?**

**Why CameraX and not hand-rolled Camera2** (see "Migrated to CameraX" below
for the full story): an earlier version of this app used the raw Camera2 API
directly, including hand-derived preview-scaling and rotation Matrix math.
That math was wrong on real hardware in three different ways across three
attempts, because getting `TextureView`+`SurfaceTexture` sizing and
`SENSOR_ORIENTATION` rotation exactly right by pure derivation, with no device
available to check against, is a well-known trap. CameraX's `PreviewView`
(`FILL_CENTER`) and `ImageAnalysis`'s own reported `rotationDegrees` are the
same primitives MediaPipe's own official Android Face Landmarker sample uses
for exactly this problem, so this now matches a working reference
implementation instead of inventing one blind. Nothing about the camera
*quality* story changed -- CameraX is still Camera2 underneath.

## What's "uplifted" here vs. the PWA

The PWA's `capture-pwa/src/capture/deviceCamera.ts` has to work within what a
browser exposes, which is a best-effort, capability-gated layer on top of the
real camera API:

- **Exposure lock**: the PWA reads whatever auto-exposure value the browser
  currently has (`track.getSettings()`), then tries to re-apply it as a
  `manual` constraint (`tryLockCapture` in `deviceCamera.ts`) -- gated on
  `MediaTrackCapabilities.exposureMode` even existing, which Safari doesn't
  expose at all. This app sets `CaptureRequest.CONTROL_AE_LOCK = true`
  directly on the sensor via CameraX's Camera2Interop escape hatch
  (`CameraXController.setAeLock`, `Camera2CameraControl` +
  `CaptureRequestOptions`) -- the literal same CaptureRequest key, still an
  unconditional, always-available Camera2 control, not a guess.
- **Resolution ceiling**: the PWA asks for `{ ideal: 3840x2160 }` and then
  re-queries `track.getCapabilities()` to try to hit the browser-negotiated
  max (`pickMaxResolutionConstraints`). This app reads
  `CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP` directly for the
  sensor's actual maximum JPEG output size -- no negotiation layer in between.
- **Manual controls in general**: focus distance, torch, white balance are all
  `MediaTrackConstraints` the PWA can only request and hope for; here torch is
  a first-class CameraX `CameraControl.enableTorch()` call, and AE/AWB lock
  are literal Camera2 `CaptureRequest` keys reached through CameraX's
  `Camera2Interop` escape hatch (`CameraXController.setAeLock`) -- still
  Camera2 underneath, not a browser-style capability guess.

If the native build's captures look sharper, better-exposed, or more
consistent than the PWA's, this is why -- not a difference in the tracking
or gate logic, which is a deliberate 1:1 port (see below).

**Honest scope check**: the above is real but partial. `CONTROL_AE_LOCK`/
`CONTROL_AWB_LOCK` freeze whatever auto-exposure/auto-white-balance last
converged to -- genuinely more reliable than the PWA's capability-gated
guess, but still not the same thing as true manual control. Camera2 also
exposes, and this app does **not** yet use: manual ISO/shutter speed
(`CONTROL_AE_MODE_OFF` + `SENSOR_EXPOSURE_TIME`/`SENSOR_SENSITIVITY`), RAW
sensor capture (`ImageFormat.RAW_SENSOR`/DNG -- arguably Camera2's biggest
advantage over any browser API), manual focus distance
(`LENS_FOCUS_DISTANCE`), video stabilization, pinned frame-rate ranges, or
Camera2 Extensions (night mode/HDR/additional physical lenses). Treat this
as a first real step up from the PWA, not the ceiling of what Camera2 can
do.

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
  Android AAR instead of the wasm runtime. Fed frames from CameraX's
  `ImageAnalysis` (RGBA_8888, rotated only -- never mirrored, see
  `CameraXController.handleAnalysisFrame`'s doc comment on why mirroring must
  stay a display-only transform to match the calibrated sign convention).
- `src/capture/captureSequence.ts` -> `capture/CaptureSequence.kt`: same
  three-still-candidates-then-lock-then-sweep-video flow, same timing
  constants (120ms between stills, 500ms settle, 5s sweep), now driving
  `CameraXController` (`ImageCapture`/`VideoCapture`+`Recorder`) instead of
  raw `CameraCaptureSession` requests.
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

- Actual camera preview, capture, and video-recording behavior end-to-end
  under the CameraX architecture (see "Migrated to CameraX" below).
- The MediaPipe Face Landmarker's live-stream detection against real camera
  frames (the RGBA_8888 `ImageAnalysis` -> `Bitmap` conversion path in
  `CameraXController.rgbaImageProxyToBitmap` in particular -- it's a direct
  buffer copy, simpler than the hand-rolled YUV conversion it replaced, but
  still unverified against actual sensor output on a specific device).
- Whether `PreviewView`'s `FILL_CENTER` scale type and `ImageAnalysis`'s
  reported `rotationDegrees` produce a correctly-oriented, undistorted
  preview and correctly-aligned mouth box -- this is the exact problem
  three straight attempts at hand-rolled Camera2 Matrix math failed to
  solve (see "Migrated to CameraX" below for why CameraX was adopted
  instead of a fourth attempt), and while `PreviewView`/`ImageAnalysis`
  are well-tested library code rather than another hand-derived formula,
  "well-tested by Google" is not the same claim as "verified in this app,
  on this device."
- UI layout on a real screen (touch targets, debug panel scroll behavior,
  countdown numeral placement).
- Battery/thermal behavior of running CameraX (Preview + ImageAnalysis +
  MediaPipe GPU delegate + ImageCapture/VideoCapture) concurrently.
- The rebind-to-swap-use-cases pattern in `CameraXController.
  startVideoRecording`/`stopVideoRecording` (drops `ImageCapture`, adds
  `VideoCapture` for the sweep, then rebinds back) -- structurally mirrors
  what the original Camera2Controller did with `CameraCaptureSession`
  reconfiguration, but CameraX's own rebind path is untested here.

## Migrated to CameraX (Camera2 was hand-rolled and got rotation/scaling wrong 3x)

The first three rounds of on-device feedback on this app were all the same
underlying problem, fixed differently each time and still wrong:

1. **Round 1**: preview distorted (stretched) -- `Camera2Controller.open()`
   requested the raw `TextureView` pixel size as the camera buffer size,
   which the sensor doesn't support, so hardware silently stretched to fill
   it. Fixed with a center-crop `Matrix` on the `TextureView`.
2. **Round 2**: "confused what direction it points to" -- the center-crop
   matrix's rotation math (adapted from the classic, notoriously fiddly
   Camera2Basic sample) mismatched dimensions and used the wrong rotation
   basis. Re-derived from scratch in 3 traceable steps.
3. **Round 3**: still wrong on-device after the re-derivation. Added a
   manual "Rotate 90°" debug-panel override as a stopgap rather than
   attempt a fourth blind guess.

At that point the right call was to stop hand-deriving Camera2 Matrix math
entirely, not attempt a fourth fix. **This app now uses CameraX**
(`androidx.camera:*:1.3.4`) instead of raw `CameraCaptureSession`/
`TextureView`:

- `PreviewView` (`app:scaleType="fillCenter"`) replaces `TextureView` +
  the hand-derived preview `Matrix` entirely -- CameraX owns buffer sizing,
  center-crop scaling, and rotation.
- `ImageAnalysis` (`OUTPUT_IMAGE_FORMAT_RGBA_8888`) replaces the manual
  `ImageReader` + YUV_420_888-to-NV21-to-JPEG-to-Bitmap conversion.
  `imageProxy.imageInfo.rotationDegrees` reports the correct rotation
  directly -- computed by CameraX from the sensor orientation and current
  display rotation, not re-derived by hand.
- `OverlayView`'s mouth-box mapping (`ViewfinderActivity.
  updateOverlayTransform`) now recomputes its center-crop scale/offset
  from the *actual* delivered analysis-frame dimensions on every frame,
  rather than a separately-queried "preview size" that had to be kept in
  sync by hand -- this is more robust than the old approach by
  construction, not just simpler: a mismatch between the preview and
  analysis stream's aspect ratios (a real bug in an earlier round) can no
  longer cause the box to drift, because the mapping is always derived
  from whatever CameraX actually delivered.
- `ImageCapture` (`CAPTURE_MODE_MAXIMIZE_QUALITY`) replaces the manual max-
  JPEG-size `ImageReader`. `VideoCapture<Recorder>` replaces `MediaRecorder`
  + a raw recorder `Surface`, with `Recorder.Builder().
  setTargetVideoEncodingBitRate(...)` still honoring
  `TARGET_VIDEO_BITRATE_BPS` (an early draft of this migration silently
  dropped that bitrate target by building the `Recorder` once with a
  hardcoded `Quality.HD` instead of using the caller's requested size/
  bitrate -- caught and fixed before shipping, see git history on
  `CameraXController.startVideoRecording`).
- `CONTROL_AE_LOCK`/`CONTROL_AWB_LOCK` are still set as literal Camera2
  `CaptureRequest` keys, via CameraX's `Camera2Interop`
  (`Camera2CameraControl` + `CaptureRequestOptions`) -- **the "uplifted
  hardware" story is unchanged**, this is not a downgrade to a
  browser-like API, it's removing hand-rolled boilerplate around the same
  underlying Camera2 controls.
- Same 3-concurrent-stream discipline as the original Camera2Controller:
  preview+analysis+still-capture normally, rebinding to preview+analysis+
  video only for the duration of the sweep recording, since 4 concurrent
  use cases isn't a combination every device's hardware level guarantees.

This is why the manual "Rotate 90°" debug button from round 3 is gone --
`PreviewView`/`ImageAnalysis` own that problem now instead of a hand-rolled
formula, so there's nothing left for a manual override to correct *against*.
If the preview is still wrong after this change, that's new information
(a CameraX-level issue, or something specific to the test device), not the
same bug persisting.

**Round 4 result: the CameraX migration fixed the preview/tracking problem.**
On-device feedback confirmed live preview and mouth-box tracking both work
correctly now -- auto-capture fires, gates track properly, images save. A
narrower, different bug then showed up one layer downstream: saved still
photos appeared sideways in the gallery. Root cause and fix:

`ImageCapture.takePicture()` has two variants. The file-writing variant
(`OutputFileOptions` + `OnImageSavedCallback`) bakes correct orientation
into the saved JPEG automatically. `CaptureSequence` needs the in-memory
variant instead (`OnImageCapturedCallback`) specifically because it scores
3 still candidates before picking the best one, and that variant does
**not** auto-orient -- it hands back raw sensor-orientation bytes and
expects the caller to apply `ImageProxy.imageInfo.rotationDegrees` itself.
`CameraXController.captureStillJpeg` wasn't doing that, so saved stills
inherited the sensor's raw (landscape) orientation. Fixed in
`CameraXController.reorientJpeg`: decode, rotate by `rotationDegrees`
(the same `rotateBitmap` helper already used for analysis frames), and
re-encode once at capture time, so every downstream consumer (gallery
thumbnail, any future full-screen viewer) gets already-correct pixels
without needing to be EXIF-aware.

Video recording (`VideoCapture<Recorder>`) is unaffected by this --
CameraX's `Recorder` writes orientation metadata into the MP4 container
automatically and reliably, unlike the raw in-memory JPEG path.

Treat the first real-device run against this CameraX version as the actual
start of testing, the same way the PWA's own thresholds (documented
throughout `config.ts`) were tuned only after on-device feedback, not
assumed correct from the start.
