# Gavan Guided Capture — Technical Specification

**Purpose of this document**: a complete, code-grounded description of how the app currently works, for an AI agent (or human) to audit against the stated goal and propose improvements. Every mechanism described below is cited to its source file so claims can be checked against the actual code, not just this summary.

**Provenance note**: there is no canonical product-spec file checked into this repository. The goal statement in §1 is reconstructed from source comments and `README.md`, which repeatedly reference an external "handoff document" and a "Smart Frame spec" that were provided out-of-band during development and are not present in the repo. If the goal below is wrong or incomplete, correct it before using this doc to drive an audit — everything in §§2–14 is a description of current behavior, and is only useful in light of an accurate goal.

**No real-device testing has happened inside the dev environment, ever.** Every real-device fact in this document (angle sign convention, the MAR-vs-smile-width miscalibration, a video frame-rate regression, a capture-time crash, an overlay that hid the user's face) was discovered by the human tester on a real phone and reported back in words — never observed directly by whichever agent wrote the fix. This is a standing structural limitation (camera access needs a secure-context real device; the sandbox has none), not a one-off gap, and it means several "fixed" items below are fixes for a *hypothesis* about the reported symptom, not a confirmed root cause. Each is flagged individually in §14.

---

## 1. Goal

Gavan Guided Capture is a browser-based PWA that guides a patient or clinician to take a **consistent, well-posed, adequately-lit photo (plus a short supplementary video) of a smile, for dental shade-matching** — i.e. downstream comparison/measurement of tooth color against a reference. Concretely, the app exists to solve:

1. **Repeatability** — freehand smartphone photos vary wildly in angle, framing, and expression; shade comparison needs photos that are comparable to each other. The app enforces this via live pose (pitch/yaw) and smile-width gating before it will auto-capture.
2. **Color-usable image quality** — the measurement image must never come from lossy video encoding (color-shifting compression), must avoid clipped highlights, and should be captured at the sensor's best available resolution.
3. **Calibration for color correction** — an optional physical reference card (ArUco fiducial markers + a glossy reference patch) held in-frame lets the app record card-visibility/flatness and an estimated light-source direction alongside the image, so shade data can later be corrected for lighting.
4. **On-device privacy** — no upload, no server, everything (image, video, metadata) stays in the browser's IndexedDB. The PWA is fully installable and works offline (camera + face-tracking model + calibration-card library are all bundled, not fetched from a CDN).
5. **Cross-platform reach** — must work on both iOS Safari and Android Chrome despite their differing camera/media APIs, degrading gracefully rather than requiring a specific platform.

An explicit open product decision (not yet made, see §13): whether the shipped mode is **front camera** (unassisted patient self-capture, mirrored preview) or **rear camera** (clinician/assistant operates the phone, materially better color data). Both code paths exist; `CAPTURE_MODE` in `src/config.ts` currently defaults to `'front'`.

---

## 2. Tech stack

- **Vite + TypeScript**, vanilla DOM (no UI framework)
- **`@mediapipe/tasks-vision` `FaceLandmarker`** (GPU delegate) for real-time face landmark tracking
- **`js-aruco2`** (vendored, loaded via `<script>` tags — see §9) for ArUco fiducial marker detection
- **IndexedDB** (native API, thin wrapper in `captureStore.ts`) for all persistence
- **`vite-plugin-pwa`** for the offline service worker + manifest
- **Vitest** for unit tests; **Playwright** for two headless smoke/offline scripts (no framework-level E2E)
- Deployed as a static subproject (`capture-pwa/`) inside the `korm85/NewsAggregator` repo, published to GitHub Pages under `/NewsAggregator/`

## 3. Architecture — three layers

| Layer | Location | Contract |
|---|---|---|
| 1. Tracker | `src/tracker/mediapipeTracker.ts` | `Tracker` interface → `TrackerResult` (pose angles, mouth box, smile metrics). Only file that imports `@mediapipe/tasks-vision`. |
| 2. Gates | `src/gates/smartFrameEvaluator.ts` | Pure function: `(SmartFrameInputs, prevState) → SmartFrameEvaluation`. No DOM access, deterministic, unit-tested. |
| 3. UI / Capture | `src/ui/*`, `src/capture/*`, `src/main.ts` | Camera setup, canvas overlay drawing, capture sequence, screens, orchestration. |

**Update since first draft of this document**: the older 7-gate system (`gates/gateEvaluator.ts`, `capture/captureController.ts`, `gates/types.ts`, `capture/exposureSample.ts`) flagged below as dead code has since been **deleted outright**. Its `distance` and `roll` thresholds were reused directly in `smartFrameEvaluator.ts` (see §7) rather than discarded. `evaluateSmartFrame` is now the only gate evaluator in the codebase.

## 4. Screen / state machine

`src/main.ts` orchestrates five screens, all rendered into a single `#app` root:

```
permission ──(Enable camera)──▶ loading ──▶ viewfinder ◀──▶ gallery
      │                            │
      └───(denied)──▶ denied ──────┘ (retry re-enters permission flow)
```

- `permissionScreen.ts` — pre-prompt before the native `getUserMedia` dialog.
- `loadingScreen.ts` — shown while the camera starts and the MediaPipe model loads (two sequential async steps, each with its own status text).
- `deniedScreen.ts` — shown if `getUserMedia` rejects; offers retry.
- `viewfinderScreen.ts` — the main live-capture UI (§10).
- `galleryScreen.ts` — review/save/delete previously saved captures (§8), reachable any time via a top-bar button, independent of session state.

`main()` fires `initCardDetector()` (ArUco script loading, §9) in the background without awaiting it, then shows the permission screen. `onEnableCamera()` starts the camera, initializes the tracker, then calls `startViewfinder()`, which owns all live-loop state (capture flags, session count, Smart Frame gate state) as closures and drives the `onFrame()` tracking loop via `requestVideoFrameCallback` (falling back to `requestAnimationFrame`).

## 5. Camera acquisition & quality (`src/capture/deviceCamera.ts`)

- `startCamera(facing)` calls `getUserMedia` with `facingMode`, `width: {ideal: 3840}`, `height: {ideal: 2160}`, `frameRate: {ideal: 30}`.
- `maximizeResolution()` then re-queries the **negotiated** track's own `getCapabilities().width/height.max` and re-applies those exact values (via `pickMaxResolutionConstraints`, unit-tested) as `ideal` — never `exact` — constraints, alongside `frameRate: {ideal: 30}`. This lets every device hit its own real ceiling instead of a guessed common denominator, and the paired frame-rate hint prevents the browser from silently trading frame rate for resolution (a real regression that was found and fixed this way — a phone's absolute max resolution is often a photo-mode the sensor only drives at 10–15fps).
- Runtime camera switch (front ⇄ rear) with no page reload; torch/flash support is capability-detected and the button hidden when unsupported (front cameras essentially never have one).
- `tryLockCapture(track)` / `releaseLock(track)`: best-effort manual exposure/white-balance/focus lock around each capture, reading the *current* auto-computed values via `getSettings()` before switching to manual (switching to `'manual'` without a value snaps some Android devices to a near-black default instead of preserving the live preview's exposure). Silently no-ops on platforms without these constraints (Safari).

## 6. Tracking layer (`src/tracker/mediapipeTracker.ts`)

- `FaceLandmarker`, `delegate: 'GPU'`, `runningMode: 'VIDEO'`, `numFaces: 1`, `outputFacialTransformationMatrixes: true`.
- Runs **on the main thread**, once per `onFrame()` tick (no Web Worker — see §14).
- **Pose angles**: derived from the face transformation matrix's forward axis (column 2, indices 8/9/10). `offAxisDeg` is the cone angle off the camera's optical axis (`acos(|fz|/|f|)`). `yawDeg`/`pitchDeg` are `atan2` decompositions of the *same* forward vector against z on each axis independently — deliberately not a 3-axis Euler decomposition, which would reintroduce rotation-order ambiguity. `rollDeg` comes from column 1 (face-up axis). A single sign-convention constant pair, `X_SIGN = -1` / `Y_SIGN = 1`, is the one place mirror-correction is applied; every other layer consumes the already-corrected `offAxisVec`/`yawDeg`/`pitchDeg`, never the raw matrix.
- **Mouth box**: bounding box of 20 outer-lip landmark indices (standard MediaPipe `FACEMESH_LIPS` outer ring), padded 15% each side, then EMA-smoothed frame-to-frame (`alpha = 0.3`) to reduce jitter. Drives the on-screen outline, the still-image crop region, and the card-guide anchor.
- **`mar`** (Mouth Aspect Ratio — inner-lip vertical gap ÷ mouth width): kept only as a low "mouth isn't literally closed" floor. Confirmed on-device to be the *wrong* primary smile signal — a real wide smile with teeth rows close together scored `mar 0.248`, well below a mouth-agape (non-smiling) reference at `mar 0.784`.
- **`smileWidthRatio`** (mouth width ÷ interocular distance, outer eye corners 33/263): the actual "smiling wide" signal, added to replace MAR as primary. Uses eye-to-eye distance as a per-face scale reference that doesn't change when someone smiles.
- **`landmarkChecksum`**: sum of lip-landmark pixel coordinates. Was used only by the now-deleted 7-gate stability check; still computed and returned on every `TrackerResult` but nothing currently reads it — a small, harmless piece of dead weight left over from that deletion.

## 7. Gate evaluation — "Smart Frame" (`src/gates/smartFrameEvaluator.ts`, thresholds in `src/config.ts`)

Pure function `evaluateSmartFrame(inputs, prevState) → evaluation`. Seven possible gates, `'face' | 'pitch' | 'yaw' | 'roll' | 'distance' | 'smile' | 'card'`; `'card'` only participates when cardboard mode is on (`activeGateIds()`) — `roll` and `distance` are always active, added to strictly lock the starting geometry before the video-first "Active Sweep" capture window (§8) begins.

| Gate | Pass condition | Enter / exit (hysteresis) |
|---|---|---|
| `face` | a face is detected this frame | n/a |
| `pitch` | `\|pitchDeg\| ≤` threshold | 15° / 18° |
| `yaw` | `\|yawDeg\| ≤` threshold | 15° / 18° |
| `roll` | `\|rollDeg\| ≤` threshold | 5° / 6° (reused from the deleted 7-gate system's threshold, unchanged) |
| `distance` | mouth-box width (fraction of frame width) within `[min, max]` | default `0.15`/`0.25` (`DISTANCE_GATE_DEFAULTS`), **runtime-adjustable** (§12), `±0.02` hysteresis buffer applied once passing |
| `smile` | `mar ≥` floor **and** `smileWidthRatio ≥` threshold | mar 0.08/0.05, width 0.55/0.45 |
| `card` (cardboard only) | all 4 ArUco markers visible **and** card held flat | no hysteresis — direct per-frame read; a `null` detection (throttled frame) carries the previous verdict forward instead of failing |

- **Hysteresis**: every continuous gate has a wider "stay passing" band than "start passing" band (`passMax`/`passMin`/`passDistance` in the evaluator), so a value oscillating near the boundary doesn't flicker the outline color.
- **Prompt selection**: the single highest-priority *failing* gate (iteration order `face → pitch/yaw → roll → distance → smile → card`) drives the on-screen prompt text and, for pitch/yaw, a directional arrow (`resolveAngleDirection`, reading the signed `offAxisVec`). Once shown, a prompt is locked for a minimum `800ms` (`minPromptDisplayMs`) even if the underlying failing gate changes mid-window, to avoid rapid text-swapping.
- **Auto-capture trigger**: fires once *every currently-active* gate has held passing for `holdFramesRequired = 5` consecutive frames.
- **Capture trigger mode** (`src/main.ts`, not part of the evaluator itself): a runtime **Auto/Manual toggle** in the viewfinder, default Auto. In Auto, the shutter button is disabled outright and only the auto-trigger above can fire capture. In Manual, gates are guidance only — the button is enabled whenever a face is detected, regardless of gate state, as a deliberate bypass. (An earlier design had manual capture bypass gates unconditionally with no mode toggle at all; this two-mode split was chosen instead so gate-strictness is explicit and switchable rather than baked into one behavior.)
- **`frameColor`**: `'green'` (all active gates passing), `'amber'` (some failing), `'none'` (no face).

## 8. Capture sequence — "Active Sweep" (`src/capture/captureSequence.ts`, timing in `CAPTURE_SEQUENCE`)

Triggered by either the auto-trigger or the manual button, both funneling through `performCapture()` in `main.ts`, which flips a `capturing` flag (disabling re-entry and pausing the tracking loop, see §14) before calling `runCaptureSequence()`. The design inverted from an earlier version: previously the still image (scored from a 15-frame burst) was the primary color-measurement artifact and the video was purely supplementary; now the **video is primary** and the still is a single anchor frame, because the downstream color-calibration algorithm needs multiple reflection angles (from the video) to extract angular telemetry and remove glare offline, not a single glare-free still.

1. Build the overlay text lines that will be burned into the saved image: `pitchDeg`/`yawDeg`/`rollDeg`/`mar`/`smileWidthRatio`, card status (if cardboard mode), ISO timestamp.
2. Compute the normalized crop region: the padded mouth box, expanded to also include the card-guide region when cardboard mode is on (`cardGuideRegion.ts`, so a "with card" capture doesn't crop the card out).
3. `tryLockCapture()` — attempt manual exposure/WB/focus lock.
4. `sleep(sensorSettleMs = 500ms)` to let the lock settle.
5. Grab a **single** uncompressed canvas frame at this exact instant — before the sweep below begins — as the color anchor. No scoring or multi-frame comparison anymore; this is the strictly-gated starting frame, take it or leave it. `ImageCapture.takePhoto()` (the browser's native photo pipeline, Chrome/Android only) is **not used at all** — removed because it applies irreversible hardware tone mapping, judged worse for a color-calibration anchor than the resolution it would have gained.
6. Start the supplementary `MediaRecorder` recording directly from the raw track — full-frame, not cropped, `.webm` (feature-detected mimeType), at a maximized target bitrate (`TARGET_VIDEO_BITRATE_BPS = 16,000,000`, an `ideal`-style hint the encoder clamps rather than errors on). This is now the **primary** color-calibration artifact, not supplementary in name only.
7. `sleep(burstDurationMs = 5000ms)` — the user is prompted (`ACTIVE_SWEEP_PROMPT`, "Slowly move camera side-to-side") to sweep the camera during this window, deliberately the opposite of the old "hold still" burst design. No highlight clipping/rejection is applied to the video — every specular highlight is passed through unmodified, since the offline processor is expected to use them, not avoid them.
8. Stop the video recording. Best-effort: `null` on any failure or unsupported browser, and a recording failure never affects the already-captured still.
9. Haptic pulse (`navigator.vibrate(60)`) + a short 880Hz tone (Web Audio) as a redundant, non-visual capture confirmation.
10. `releaseLock()` — return exposure/WB/focus to continuous/auto.
11. Return `{ imageUrl, blob, metadata }`; `main.ts` maps this into a `StoredCapture` and persists it (§10). `stillSource` no longer exists as a field — there's only one still-image pipeline now.

## 9. Calibration-card subsystem ("Cardboard mode")

A top-left toggle switches the Smart Frame between two modes (§7 table). When on:

- **`cardDetector.ts`**: ArUco marker detection via **vendored** `js-aruco2` — loaded as real `<script>` tags (`initCardDetector()`), not a bundled `import`, because the library's legacy `this.AR = AR` top-level-scope pattern breaks under Vite/Rollup's CommonJS interop (builds clean, `AR` comes back `undefined` at runtime). Detection runs on a **downscaled full-frame sample** (max 480px wide) on a **200ms throttle** (`CARD_CHECK_INTERVAL_MS`), separate from and much slower than the per-frame pose-tracking loop, because ArUco detection is comparatively expensive.
- Expects 4 corner markers (`CARD_CONFIG.expectedMarkerIds = [0,1,2,3]`), assumed mapped in order to TL/TR/BR/BL — **explicitly a placeholder** pending the real physical card's design (none exists to test against yet).
- **Flatness**: the marker quad's two diagonals' length-ratio deviation must be `≤ 0.25` (`maxDiagonalRatioDeviation`) to count as "held flat".
- **`lightEstimator.ts`**: within a reference-patch region (bilinearly interpolated placeholder center inside the marker quad), finds the single brightest pixel and reports its offset from the expected center as a normalized 2D vector. This is explicitly a coarse heuristic ("light leans this way"), **not** a solved 3D photometric-stereo estimate — no calibrated rig exists for that.
- Both `lightDirection` and full card-detection detail are stored per-capture (§10) but only ever populated in cardboard mode.

## 10. Persistence (`src/storage/captureStore.ts`, IndexedDB)

- DB `gavan-capture-store`, version 1, single object store `captures` keyed by `id`.
- `StoredCapture` fields: the still-image `Blob` (single anchor frame, §8), all pose/smile metrics (`offAxisDeg`, `offAxisVec`, `rollDeg`, `pitchDeg`, `yawDeg`, `mar`, `smileWidthRatio`, mouth-box dimensions — `mouthBoxWidth` doubles as the distance-gate ratio), `exposureLockSuccess`, `captureMode`, `capturedAt`, cardboard/card fields (`cardboardMode`, `cardMarkersDetected`, `cardAllMarkersVisible`, `cardIsFlat`), `lightDirection` (nullable), video fields (`videoBlob`/`videoMimeType`/`videoDurationMs`, all nullable — now the primary artifact, §8).
- No network calls anywhere in this module or its callers — everything is local. `clearCaptures()` wipes the entire store ("Clear all" in the gallery).
- Session cap `MAX_SESSION_CAPTURES = 8` limits captures **per sitting** (button reads "Full" past that); there is no cap or quota check on total on-device storage across sessions (see §14).

## 11. Gallery (`src/ui/galleryScreen.ts`)

- Grid of every capture ever saved (not just the current session), one thumbnail each, with a small video-camera badge icon overlay only when a clip was recorded (no raw-angle badge on thumbnails).
- Lightbox (tap a thumbnail): full image, the video player (if present, shown **full-frame**, no crop simulation — a deliberate scope cut, see the "video crop" note in §14), a formatted date/time subtitle, Save-to-device (a `download` link to the blob) and Delete actions, and a collapsed `<details>` "Capture details" disclosure holding all raw metadata (pitch/yaw/roll, smile width, MAR, mouth-box %, exposure-lock state, capture mode, and — cardboard captures only — marker/flatness status and light direction). The "Image source" row (canvas vs. ImageCapture) that used to appear here was removed along with `ImageCapture` itself (§8) — there's only one still-image pipeline now.

## 12. Viewfinder UI (`src/ui/viewfinderScreen.ts`, `src/ui/overlay.ts`, `src/style.css`)

- Live `<video>` (mirrored when front-facing, per `MIRRORED` in config) with a `<canvas>` overlay drawing the color-coded mouth-box outline + directional arrow, plus a dashed card-guide region when cardboard mode is on.
- **Prompt banner**: a small pill at top-center, the single highest-priority guidance text (§7), green border when passing, amber otherwise, hidden entirely when there's nothing to say.
- **Live numeric readout**: `pitchDeg`/`yawDeg`/`rollDeg`/`mar`/`smileWidthRatio`/hold-count text, with an "OPTIMAL" label when the frame is green.
- **Shutter button**: circular; in Auto mode (default) always disabled — capture only fires via the gate-hold auto-trigger. In Manual mode, disabled only with no face detected, mid-capture, mid-camera-switch, or session-full. During an active capture it turns **red with a live countdown printed on the button itself** (`startCaptureCountdown` in `main.ts`), showing the static prompt "Slowly move camera side-to-side" in the prompt banner for the window's duration, then briefly flashes green with "Saved" before resetting. The red-countdown-on-button design replaced an earlier full-screen dimming overlay that (per real-device report) hid the user's own face for the entire ~5.5s capture window.
- Top-left cluster: Switch camera, Flash/torch (hidden unless the active camera reports support), Cardboard toggle, **Manual** toggle (Auto/Manual capture trigger mode, §7), **Debug** button (reveals a small panel with two range sliders that adjust the distance gate's `[min, max]` live, seeded from `DISTANCE_GATE_DEFAULTS`, hidden by default — a POC tuning aid, not intended as a shipped end-user control). Cardboard toggling resets in-progress hold-to-capture state, since the active gate set changes.
- Top-right: Gallery button, always visible/enabled regardless of session state.
- Session badge ("Saved n/8") appears once at least one capture has been made this session.
- With five controls now in `.top-bar-left` (Switch, Flash, Cardboard, Manual, Debug), the cluster wraps (`flex-wrap: wrap`) rather than overflowing on narrow screens — unverified on a real small-screen device, same caveat as everything else UI-related in this project.

## 13. PWA / offline infrastructure

- `vite-plugin-pwa` in `generateSW` mode precaches ~23 entries (~36MB, dominated by the MediaPipe model + WASM runtime + vendored ArUco JS).
- The MediaPipe model (`public/models/face_landmarker.task`), its WASM runtime (`public/wasm/`), and the vendored ArUco library (`public/vendor/js-aruco2/`) are all served from the same origin, never a CDN — verified to load and run fully offline, including camera + model init, via `scripts/offline-test.mjs`.
- Deployed as a static site to GitHub Pages at `https://korm85.github.io/NewsAggregator/` (Vite `base: '/NewsAggregator/'`); `capture-pwa/` is a subproject inside the broader `korm85/NewsAggregator` repository, unrelated in purpose to the rest of that repo.

## 14. Known gaps, unverified areas, and explicitly flagged risks

Grouped by theme — this is the primary input for an audit against the goal in §1.

**Calibration / accuracy fidelity (directly affects shade-matching goal):**
- Calibration card layout (`CARD_CONFIG`) is entirely placeholder — no real printed card exists yet to detect against.
- Light-direction estimation is a coarse 2D "brightest pixel offset" heuristic, explicitly not a solved photometric estimate.
- `smileWidth` gate threshold (0.55/0.45) is anchored to exactly **one** real data point (one person's intentionally maximal smile scoring 0.71) — not a calibration set across face shapes, ages, or smile styles.
- **New**: `distance` gate threshold (`DISTANCE_GATE_DEFAULTS`, 0.15/0.25, approximating 15-25cm) is an **unverified starting estimate**, the same shape of guess that took two wrong tries before `smileWidth` was corrected with real data. Mitigated by being runtime-adjustable (the Debug panel, §12) rather than requiring a redeploy to retune, but it ships uncalibrated by design.
- **Resolved**: the exposure-lock-vs-`ImageCapture` question is now moot — `ImageCapture` has been removed entirely (§8), specifically because its irreversible hardware tone mapping was judged a worse tradeoff for a color-calibration anchor than the resolution it offered.
- **Resolved**: roll is now gated (§7), reusing the deleted 7-gate system's threshold unchanged. Distance is a new gate alongside it. Both were added specifically to "lock the starting geometry strictly" before the Active Sweep window begins.
- **New, and the single largest behavioral risk of this round of changes**: the still-image anchor now has **no fallback frame**. The prior design scored 15 canvas frames and kept the best (sharpest, least clipped); the current design grabs exactly one frame at the instant the capture window starts. A blink, motion blur, or a stray highlight at that exact instant has no recovery path within a single capture — this is an accepted tradeoff (the video is now the real data), not an oversight, but it does mean the still anchor's reliability bar is lower than before.
- **New**: whether the actual downstream color-calibration/glare-removal system's input expectations (bitrate, container format, frame rate, expected sweep speed/pattern) match what this app now produces is an **unverified assumption** — `TARGET_VIDEO_BITRATE_BPS = 16,000,000` and the "Slowly move camera side-to-side" prompt wording are both reasonable guesses, not confirmed against that system's actual requirements, which live outside this repo entirely.

**Reliability / performance:**
- One reported on-device crash right at the end of the 5-second capture window was addressed by pausing the live tracking loop during capture (a resource-contention hypothesis — MediaRecorder + burst + possible ImageCapture + GPU-delegated tracker all running concurrently) — **root cause unconfirmed**, no crash log or stack trace was ever obtained. The fix (pausing tracking during capture) is unchanged by this round and still applies to the Active Sweep window.
- No Web Worker: the face tracker and gate evaluator both run on the main thread every frame.
- Video storage growth is unmanaged — no `navigator.storage.estimate()` / quota handling — and **just got worse**: maximizing the recording bitrate (§8) makes each 5-second full-frame clip larger than before, on purpose, at up to 8 captures/session.
- Video-recording performance on lower-end phones at the new higher bitrate is unverified — more so than before, since a higher bitrate is a heavier ask of the encoder. The concurrent-canvas-burst contention concern from the prior round is now moot (there's no more canvas burst, §8), but recorder-alone performance at this bitrate hasn't been checked either.

**Verification coverage:**
- No real device has ever been available inside the dev/CI environment (see the note at the top of this document) — every real-device-only fact here came from the human tester, second-hand.
- ArUco detection accuracy against a real card, and the with-cardboard gate path generally, is exercised only by "does the toggle crash the loop" smoke testing, not detection accuracy.
- The capture-button countdown is a local timer approximating `CAPTURE_SEQUENCE`'s configured durations, not synchronized to the actual recording — can drift under real per-frame processing overhead.
- The new Manual/Auto toggle and Debug distance-range panel are only smoke-tested for "doesn't crash," not evaluated for real-device look/feel or whether the now-five-control `.top-bar-left` cluster wraps sensibly on a small screen.
- **Neither the without-cardboard nor the with-cardboard capture path has been re-verified against the new roll/distance gates or the Active Sweep flow on a real device** — the last real-device confirmation predates this round of changes entirely.

**Code health:**
- **Resolved**: the pre-Smart-Frame 7-gate system (`gateEvaluator.ts`, `captureController.ts`, `gates/types.ts`, `exposureSample.ts`) has been deleted outright, not just left unwired. `ArrowDirection` (which that system's `types.ts` used to own) now lives in `smartFrameTypes.ts`.
- **Resolved**: `ImageCapture` (`capture/imageCapture.ts`), the `stillSource` field it introduced, and `frameScore.ts`'s `cropAndOverlayBlob` (only ever used by the ImageCapture path) have all been removed as a consequence of bypassing `ImageCapture` entirely (§8).
- Video is deliberately shown/stored full-frame with no crop-to-match-the-still-image treatment (a feature that was scoped out on cost/value grounds, not an oversight — documented for context, not flagged as a gap).

## 15. Open product decision

`CAPTURE_MODE` (`'front'` vs `'rear'`) in `src/config.ts` — both code paths are fully implemented (mirroring, direction-prompt sign, `facingMode`, all read from this one constant), but which one ships is an unresolved product/clinical-workflow call, not a technical blocker.

---

### Suggested framing for an auditing agent

Given the goal in §1 (repeatable, color-usable, calibratable, private, cross-platform smile captures) and the video-first pivot described in §§7-8, the highest-leverage audit questions are likely:

1. Is the **single-frame still anchor** (no scoring/fallback, §8) an acceptable reliability tradeoff for how the downstream system actually uses it, or does losing the best-of-15 selection risk enough blurry/blinking anchors to matter?
2. Does the **actual offline post-processor** want what this app now produces — bitrate, container format, sweep speed/pattern — or are `TARGET_VIDEO_BITRATE_BPS` and the sweep prompt's wording guesses that need to be confirmed against that system's real contract?
3. Are the **`smileWidth` and `distance` thresholds** — both single-data-point-or-worse calibrations — a real risk of false negatives/positives across the patient population this will actually see, and is the runtime-adjustable Debug panel a sufficient mitigation or just a deferred problem?
4. Is **storage growth** (uncapped across sessions, video now recorded at a higher bitrate than before) a real problem at expected usage volumes, and if so what's the cheapest fix (cap total on-device size? lower the bitrate target? compress?)
5. Given the crash was "fixed" by hypothesis rather than diagnosis, is there a way to get real crash telemetry (e.g. a lightweight error-reporting hook) before this ships, rather than continuing to patch blind?
6. Is the calibration-card/light-estimation subsystem worth hardening now, or genuinely blocked on a real card design (in which case, is there lower-risk work to prioritize instead)?
7. Does the **Auto/Manual capture-trigger toggle** (§7) make sense as a shipped feature, or should it be a dev-only affordance like the Debug panel — right now both live in the same always-visible top-left cluster with no visual distinction between "core interaction" and "POC tuning tool."
