import { renderPermissionScreen } from './ui/permissionScreen';
import { renderDeniedScreen } from './ui/deniedScreen';
import { renderLoadingScreen } from './ui/loadingScreen';
import { renderViewfinderScreen, type ViewfinderRefs } from './ui/viewfinderScreen';
import { renderGalleryScreen } from './ui/galleryScreen';
import { drawCardGuide, drawOverlay } from './ui/overlay';
import { MediaPipeTracker } from './tracker/mediapipeTracker';
import { runCaptureSequence, type AuxCaptureData, type TrackerSnapshot } from './capture/captureSequence';
import { detectCard, initCardDetector, type CardDetectionResult } from './capture/cardDetector';
import { estimateLightDirection, type LightEstimate } from './capture/lightEstimator';
import { sampleVideoFrame } from './capture/frameSample';
import {
  CameraPermissionError,
  isTorchSupported,
  setTorch,
  startCamera,
  stopCamera,
} from './capture/deviceCamera';
import { saveCapture, type StoredCapture } from './storage/captureStore';
import { evaluateSmartFrame } from './gates/smartFrameEvaluator';
import { createInitialSmartFrameState, type SmartFrameGateState } from './gates/smartFrameTypes';
import { CAPTURE_MODE, CAPTURE_SEQUENCE, DISTANCE_GATE_DEFAULTS, MAX_SESSION_CAPTURES } from './config';

const root = document.getElementById('app')!;

/** How often (ms) to re-run ArUco detection on a full-frame sample while cardboardMode is on. Detection is far more expensive than pose tracking, so it runs on a slower cadence than the per-frame tracker loop. */
const CARD_CHECK_INTERVAL_MS = 200;
const CARD_SAMPLE_MAX_WIDTH = 480;

let stream: MediaStream | null = null;
let tracker: MediaPipeTracker | null = null;
let loopActive = false;
/** Which camera is active right now. Starts from config's default, but
 * can change at runtime via the Switch button (unlike v1/v2, this is no
 * longer fixed for the life of the app). */
let currentFacingMode: 'front' | 'rear' = CAPTURE_MODE;

async function main(): Promise<void> {
  // Fire-and-forget: the cardboard toggle is off by default, so this
  // doesn't need to block camera/tracker startup, just be ready by the
  // time someone flips it on. detectCard() no-ops until it resolves.
  void initCardDetector();
  renderPermissionScreen(root, onEnableCamera);
}

async function onEnableCamera(): Promise<void> {
  renderLoadingScreen(root, 'Starting camera...');
  try {
    stream = await startCamera(currentFacingMode);
  } catch (err) {
    if (err instanceof CameraPermissionError) {
      renderDeniedScreen(root, onEnableCamera);
      return;
    }
    throw err;
  }

  renderLoadingScreen(root, 'Loading capture guide...');
  tracker = new MediaPipeTracker();
  await tracker.init();

  startViewfinder();
}

function makeCaptureId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Two capture trigger modes, switched at runtime via the viewfinder's
 * Manual toggle (default: auto). In 'auto', the shutter button is
 * inert and capture only fires once the gate evaluator has held every
 * active gate (pitch/yaw/roll/distance/smile, +card in cardboard mode)
 * passing for THRESHOLDS.holdFramesRequired frames -- this is the
 * strict "lock the starting geometry" path. In 'manual', gates are
 * guidance only: the shutter button works any time a face is detected,
 * regardless of gate state, as a deliberate bypass for a tester who
 * wants a sample despite an imperfect pose.
 */
function startViewfinder(): void {
  if (!stream || !tracker) return;

  loopActive = true;
  let sessionCaptureCount = 0;
  let capturing = false;
  let switchingCamera = false;
  let torchOn = false;
  let cardboardMode = false;
  let triggerMode: 'auto' | 'manual' = 'auto';
  let distanceRange: { min: number; max: number } = DISTANCE_GATE_DEFAULTS;
  let latestSnapshot: TrackerSnapshot | null = null;
  let latestCard: CardDetectionResult | null = null;
  let latestLight: LightEstimate | null = null;
  let lastCardCheckMs = -Infinity;
  let smartFrameState: SmartFrameGateState = createInitialSmartFrameState();

  const goToGallery = () => {
    loopActive = false;
    void renderGalleryScreen(root, startViewfinder);
  };

  const refs = renderViewfinderScreen(root, currentFacingMode === 'front', DISTANCE_GATE_DEFAULTS, {
    onOpenGallery: goToGallery,
    onCapture: () => performCapture(),
    onSwitchCamera: onSwitchCameraTapped,
    onToggleTorch: onToggleTorchTapped,
    onToggleCardboard: (checked) => {
      cardboardMode = checked;
      latestCard = null;
      latestLight = null;
      lastCardCheckMs = -Infinity;
      smartFrameState = createInitialSmartFrameState();
    },
    onToggleCaptureMode: (manual) => {
      triggerMode = manual ? 'manual' : 'auto';
    },
    onDistanceRangeChange: (range) => {
      distanceRange = range;
    },
  });
  refs.video.srcObject = stream;
  refs.video.play().catch(() => {
    // Autoplay can be blocked in rare cases; the user still sees the
    // permission-granted stream once interaction resumes playback.
  });

  const overlayCtx = refs.overlayCanvas.getContext('2d')!;
  const track = stream.getVideoTracks()[0];

  const torchSupported = isTorchSupported(track);
  refs.torchButton.classList.toggle('hidden', !torchSupported);

  function updateSessionBadge(): void {
    // The Gallery button (top-bar) is always visible, saved captures
    // from earlier sessions should be reachable even before this
    // session has captured anything new. The badge itself still only
    // shows once there's something new this session to report.
    if (sessionCaptureCount === 0) {
      refs.sessionBadge.classList.add('hidden');
      return;
    }
    refs.sessionBadge.textContent = `Saved ${sessionCaptureCount}/${MAX_SESSION_CAPTURES}`;
    refs.sessionBadge.classList.remove('hidden');
  }

  function performCapture(): void {
    if (capturing || switchingCamera || !latestSnapshot || sessionCaptureCount >= MAX_SESSION_CAPTURES) return;
    capturing = true;
    refs.switchCameraButton.disabled = true;
    // Clear the Smart Frame outline rather than leaving it frozen: the
    // tracking loop pauses for the capture window below (see onFrame),
    // so nothing will redraw it until capture finishes.
    overlayCtx.clearRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height);

    const totalMs = CAPTURE_SEQUENCE.sensorSettleMs + CAPTURE_SEQUENCE.burstDurationMs;
    const stopTicking = startCaptureCountdown(refs, totalMs);
    let succeeded = false;

    const aux: AuxCaptureData = {
      cardboardMode,
      card: cardboardMode ? latestCard : null,
      light: cardboardMode ? latestLight : null,
    };

    runCaptureSequence(refs.video, track, latestSnapshot, currentFacingMode, aux)
      .then((result) => {
        stopTicking();
        succeeded = true;
        showCaptureSuccess(refs);
        const stored: StoredCapture = {
          id: makeCaptureId(),
          blob: result.blob,
          offAxisDeg: result.metadata.offAxisDeg,
          offAxisVec: result.metadata.offAxisVec,
          rollDeg: result.metadata.rollDeg,
          pitchDeg: result.metadata.pitchDeg,
          yawDeg: result.metadata.yawDeg,
          mar: result.metadata.mar,
          smileWidthRatio: result.metadata.smileWidthRatio,
          mouthBoxWidth: result.metadata.mouthBoxWidth,
          mouthBoxHeight: result.metadata.mouthBoxHeight,
          exposureLockSuccess: result.metadata.exposureLockSuccess,
          captureMode: result.metadata.captureMode,
          capturedAt: result.metadata.capturedAt,
          cardboardMode: result.metadata.cardboardMode,
          cardMarkersDetected: result.metadata.card?.markersDetected ?? [],
          cardAllMarkersVisible: result.metadata.card?.allMarkersVisible ?? false,
          cardIsFlat: result.metadata.card?.isFlat ?? false,
          lightDirection: result.metadata.lightDirection,
          videoBlob: result.metadata.video?.blob ?? null,
          videoMimeType: result.metadata.video?.mimeType ?? null,
          videoDurationMs: result.metadata.video?.durationMs ?? null,
        };
        URL.revokeObjectURL(result.imageUrl);
        return saveCapture(stored);
      })
      .then(() => {
        sessionCaptureCount++;
        updateSessionBadge();
      })
      .finally(() => {
        stopTicking();
        capturing = false;
        refs.switchCameraButton.disabled = false;
        const full = sessionCaptureCount >= MAX_SESSION_CAPTURES;
        // Leave the success checkmark up on the button briefly so it's
        // unmistakable; on a failure (rare, runCaptureSequence degrades
        // most errors internally rather than rejecting) reset immediately
        // instead of showing a fake success beat.
        window.setTimeout(() => resetCaptureButton(refs, full), succeeded ? 900 : 0);
      });
  }

  async function onSwitchCameraTapped(): Promise<void> {
    if (!stream || switchingCamera || capturing) return;
    switchingCamera = true;
    refs.switchCameraButton.disabled = true;
    refs.captureButton.disabled = true;

    const oldStream = stream;
    const nextMode = currentFacingMode === 'front' ? 'rear' : 'front';
    try {
      const newStream = await startCamera(nextMode);
      stopCamera(oldStream);
      stream = newStream;
      currentFacingMode = nextMode;
      loopActive = false;
      startViewfinder();
    } catch {
      // Camera switch failed (device may not have a second camera).
      // Stay on the current one rather than leaving a dead viewfinder.
      switchingCamera = false;
      refs.switchCameraButton.disabled = false;
      refs.captureButton.disabled = !latestSnapshot;
    }
  }

  async function onToggleTorchTapped(): Promise<void> {
    if (!torchSupported) return;
    const nextOn = !torchOn;
    const ok = await setTorch(track, nextOn);
    if (ok) {
      torchOn = nextOn;
      refs.torchButton.classList.toggle('active', torchOn);
    }
  }

  function resizeCanvas(): void {
    refs.overlayCanvas.width = refs.video.clientWidth;
    refs.overlayCanvas.height = refs.video.clientHeight;
  }
  refs.video.onloadedmetadata = resizeCanvas;
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function onFrame(): void {
    if (!loopActive || !tracker) return;

    if (capturing) {
      // Skip tracking/gate-eval/overlay-draw work for the duration of an
      // active capture: MediaRecorder + the burst loop + (maybe)
      // ImageCapture are already stacking real CPU/GPU load in this
      // window, and none of this frame's tracking result would be used
      // anyway (the trigger, if any, already fired). Keep the rAF/rVFC
      // loop alive -- so it resumes cleanly the instant capturing flips
      // back to false -- without doing any of the expensive work.
      scheduleNextFrame(refs.video, onFrame);
      return;
    }

    const now = performance.now();

    const trackerResult = tracker.detect(refs.video, now);

    if (trackerResult.detected) {
      latestSnapshot = {
        offAxisDeg: trackerResult.offAxisDeg,
        offAxisVec: trackerResult.offAxisVec,
        rollDeg: trackerResult.rollDeg,
        pitchDeg: trackerResult.pitchDeg,
        yawDeg: trackerResult.yawDeg,
        mar: trackerResult.mar,
        smileWidthRatio: trackerResult.smileWidthRatio,
        mouthBox: trackerResult.mouthBox,
      };
    } else {
      latestSnapshot = null;
    }

    if (cardboardMode && now - lastCardCheckMs >= CARD_CHECK_INTERVAL_MS) {
      lastCardCheckMs = now;
      const sample = sampleVideoFrame(refs.video, CARD_SAMPLE_MAX_WIDTH);
      if (sample) {
        latestCard = detectCard(sample);
        latestLight = latestCard.allMarkersVisible
          ? estimateLightDirection(sample, latestCard.cornerPoints as { x: number; y: number }[])
          : null;
      }
    }

    const evaluation = evaluateSmartFrame(
      {
        tracker: trackerResult,
        card: cardboardMode ? latestCard : null,
        cardboardMode,
        nowMs: now,
        distanceRange,
      },
      smartFrameState,
    );
    smartFrameState = evaluation.state;

    overlayCtx.clearRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height);
    drawOverlay(
      overlayCtx,
      refs.overlayCanvas.width,
      refs.overlayCanvas.height,
      trackerResult.mouthBox,
      evaluation.frameColor,
      evaluation.arrowDirection,
      evaluation.holdCount / evaluation.holdRequired,
    );
    if (cardboardMode && trackerResult.mouthBox) {
      drawCardGuide(
        overlayCtx,
        refs.overlayCanvas.width,
        refs.overlayCanvas.height,
        trackerResult.mouthBox,
        evaluation.gateStatuses.card,
      );
    }

    updateReadout(refs, trackerResult, evaluation);

    // Don't fight the "capturing"/"switching"/"full" disabled states the
    // click handlers set while something's already in flight. In auto
    // mode the button is inert (auto-trigger is the only path); in
    // manual mode it's the guidance-only bypass, enabled by face
    // presence alone regardless of gate state.
    if (!capturing && !switchingCamera && sessionCaptureCount < MAX_SESSION_CAPTURES) {
      refs.captureButton.disabled = triggerMode === 'auto' ? true : !trackerResult.detected;
    }

    if (
      triggerMode === 'auto' &&
      evaluation.captureTriggered &&
      !capturing &&
      !switchingCamera &&
      sessionCaptureCount < MAX_SESSION_CAPTURES
    ) {
      performCapture();
    }

    scheduleNextFrame(refs.video, onFrame);
  }

  scheduleNextFrame(refs.video, onFrame);
}

/**
 * The single guidance message shown for the entire "Active Sweep"
 * capture window: unlike the still image (a single anchor frame grabbed
 * at the very start, see captureSequence.ts), the video recording that
 * follows deliberately wants the user moving, not holding still -- the
 * offline post-processor extracts angular telemetry and removes glare
 * from the multiple reflection angles a real sweep produces. A prior
 * version rotated through several small-movement prompts timed to a
 * static burst schedule; that no longer matches this window's actual
 * purpose, so it's one constant instruction instead.
 */
const ACTIVE_SWEEP_PROMPT = 'Slowly move camera side-to-side';

/**
 * Full-window capture feedback, without ever covering the live preview:
 * the shutter button itself turns red and counts down (so it's the one
 * thing guaranteed not to hide the face being captured), and rotating
 * movement guidance goes into the existing small prompt-banner instead
 * of a dedicated overlay. A prior version used a full-screen dimmed
 * overlay card for this -- on-device that hid the user's own face for
 * the entire ~5.5s window, defeating the point of live feedback, so it
 * was removed in favor of this button+banner approach. Sound/haptics
 * alone (captureSequence.ts) were easy to miss, hence still wanting
 * *some* visible countdown, just not one that blocks the view.
 * Returns a stop function that halts the ticking (idempotent, safe to
 * call more than once) without touching button/banner state, so the
 * caller can layer the success state on top afterward.
 */
function startCaptureCountdown(refs: ViewfinderRefs, totalMs: number): () => void {
  refs.captureButton.classList.remove('captured');
  refs.captureButton.classList.add('recording');
  refs.captureButton.disabled = true;
  refs.promptBanner.classList.remove('none', 'green');
  refs.promptBanner.textContent = ACTIVE_SWEEP_PROMPT;

  const startedAt = performance.now();
  function tick(): void {
    const elapsed = performance.now() - startedAt;
    const remainingS = Math.max(0, (totalMs - elapsed) / 1000);
    refs.captureButton.textContent = remainingS.toFixed(1);
  }
  tick();
  const intervalId = window.setInterval(tick, 100);

  return () => window.clearInterval(intervalId);
}

function showCaptureSuccess(refs: ViewfinderRefs): void {
  refs.captureButton.classList.remove('recording');
  refs.captureButton.classList.add('captured');
  refs.captureButton.textContent = 'Saved';
}

function resetCaptureButton(refs: ViewfinderRefs, full: boolean): void {
  refs.captureButton.classList.remove('recording', 'captured');
  refs.captureButton.disabled = full;
  refs.captureButton.textContent = full ? 'Full' : 'Capture';
}

function scheduleNextFrame(video: HTMLVideoElement, cb: () => void): void {
  const withRvfc = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
  };
  if (withRvfc.requestVideoFrameCallback) {
    withRvfc.requestVideoFrameCallback(cb);
  } else {
    requestAnimationFrame(cb);
  }
}

function updateReadout(
  refs: ViewfinderRefs,
  tr: TrackerSnapshot & { detected: boolean },
  evaluation: ReturnType<typeof evaluateSmartFrame>,
): void {
  refs.promptBanner.classList.remove('green', 'none');
  if (evaluation.prompt) {
    refs.promptBanner.textContent = evaluation.prompt;
    if (evaluation.frameColor === 'green') refs.promptBanner.classList.add('green');
  } else {
    refs.promptBanner.classList.add('none');
  }

  refs.liveReadout.classList.remove('optimal', 'none');

  if (!tr.detected) {
    refs.liveReadout.textContent = 'No face detected';
    refs.liveReadout.classList.add('none');
    return;
  }

  const optimal = evaluation.frameColor === 'green';
  const status = optimal ? '  OPTIMAL' : '';
  refs.liveReadout.textContent =
    `pitchDeg: ${tr.pitchDeg.toFixed(2)}  yawDeg: ${tr.yawDeg.toFixed(2)}${status}\n` +
    `rollDeg: ${tr.rollDeg.toFixed(2)}  mar: ${tr.mar.toFixed(3)}\n` +
    `smileWidth: ${tr.smileWidthRatio.toFixed(2)}  hold: ${evaluation.holdCount}/${evaluation.holdRequired}`;
  if (optimal) refs.liveReadout.classList.add('optimal');
}

main();
