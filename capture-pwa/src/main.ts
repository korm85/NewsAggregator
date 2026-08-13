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
import { CAPTURE_MODE, MAX_SESSION_CAPTURES } from './config';

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
 * Smart Frame release: the color-coded outline + prompt banner drive
 * both automatic capture (fires once the gate evaluator has held all
 * active gates passing for THRESHOLDS.holdFramesRequired frames) and a
 * manual shutter button that works any time a face is detected,
 * independent of gate state, per "add auto or manual capture, auto will
 * record when conditions are met".
 */
function startViewfinder(): void {
  if (!stream || !tracker) return;

  loopActive = true;
  let sessionCaptureCount = 0;
  let capturing = false;
  let switchingCamera = false;
  let torchOn = false;
  let cardboardMode = false;
  let latestSnapshot: TrackerSnapshot | null = null;
  let latestCard: CardDetectionResult | null = null;
  let latestLight: LightEstimate | null = null;
  let lastCardCheckMs = -Infinity;
  let smartFrameState: SmartFrameGateState = createInitialSmartFrameState();

  const goToGallery = () => {
    loopActive = false;
    void renderGalleryScreen(root, startViewfinder);
  };

  const refs = renderViewfinderScreen(root, currentFacingMode === 'front', {
    onDone: goToGallery,
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
    if (sessionCaptureCount === 0) {
      refs.sessionBadge.classList.add('hidden');
      refs.doneButton.classList.add('hidden');
      return;
    }
    refs.sessionBadge.textContent = `Saved ${sessionCaptureCount}/${MAX_SESSION_CAPTURES}`;
    refs.sessionBadge.classList.remove('hidden');
    refs.doneButton.classList.remove('hidden');
  }

  function performCapture(): void {
    if (capturing || switchingCamera || !latestSnapshot || sessionCaptureCount >= MAX_SESSION_CAPTURES) return;
    capturing = true;
    refs.captureButton.disabled = true;
    refs.captureButton.textContent = '...';
    refs.switchCameraButton.disabled = true;

    const aux: AuxCaptureData = {
      cardboardMode,
      card: cardboardMode ? latestCard : null,
      light: cardboardMode ? latestLight : null,
    };

    runCaptureSequence(refs.video, track, latestSnapshot, currentFacingMode, aux)
      .then((result) => {
        const stored: StoredCapture = {
          id: makeCaptureId(),
          blob: result.blob,
          offAxisDeg: result.metadata.offAxisDeg,
          offAxisVec: result.metadata.offAxisVec,
          rollDeg: result.metadata.rollDeg,
          pitchDeg: result.metadata.pitchDeg,
          yawDeg: result.metadata.yawDeg,
          mar: result.metadata.mar,
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
        };
        URL.revokeObjectURL(result.imageUrl);
        return saveCapture(stored);
      })
      .then(() => {
        sessionCaptureCount++;
        updateSessionBadge();
      })
      .finally(() => {
        capturing = false;
        const full = sessionCaptureCount >= MAX_SESSION_CAPTURES;
        refs.captureButton.disabled = full;
        refs.captureButton.textContent = full ? 'Full' : 'Capture';
        refs.switchCameraButton.disabled = false;
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
      { tracker: trackerResult, card: cardboardMode ? latestCard : null, cardboardMode, nowMs: now },
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
    // click handlers set while something's already in flight.
    if (!capturing && !switchingCamera && sessionCaptureCount < MAX_SESSION_CAPTURES) {
      refs.captureButton.disabled = !trackerResult.detected;
    }

    if (
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
    `hold: ${evaluation.holdCount}/${evaluation.holdRequired}`;
  if (optimal) refs.liveReadout.classList.add('optimal');
}

main();
