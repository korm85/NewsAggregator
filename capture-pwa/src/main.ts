import { renderPermissionScreen } from './ui/permissionScreen';
import { renderDeniedScreen } from './ui/deniedScreen';
import { renderLoadingScreen } from './ui/loadingScreen';
import { renderViewfinderScreen, type ViewfinderRefs } from './ui/viewfinderScreen';
import { renderGalleryScreen } from './ui/galleryScreen';
import { drawOverlay } from './ui/overlay';
import { MediaPipeTracker } from './tracker/mediapipeTracker';
import { evaluateGates } from './gates/gateEvaluator';
import { createInitialGateState, type GateEvaluation, type GateState } from './gates/types';
import { sampleClippedFraction } from './capture/exposureSample';
import { CaptureController } from './capture/captureController';
import { startCamera, CameraPermissionError } from './capture/deviceCamera';
import { saveCapture, type StoredCapture } from './storage/captureStore';
import { MAX_SESSION_CAPTURES } from './config';

const root = document.getElementById('app')!;

let stream: MediaStream | null = null;
let tracker: MediaPipeTracker | null = null;
let gateState: GateState = createInitialGateState();
let loopActive = false;

async function main(): Promise<void> {
  renderPermissionScreen(root, onEnableCamera);
}

async function onEnableCamera(): Promise<void> {
  renderLoadingScreen(root, 'Starting camera...');
  try {
    stream = await startCamera();
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

function startViewfinder(): void {
  if (!stream || !tracker) return;

  gateState = createInitialGateState();
  loopActive = true;
  let sessionCaptureCount = 0;
  let sessionFull = false;

  const goToGallery = () => {
    loopActive = false;
    void renderGalleryScreen(root, startViewfinder);
  };

  const refs = renderViewfinderScreen(root, goToGallery);
  refs.video.srcObject = stream;
  refs.video.play().catch(() => {
    // Autoplay can be blocked in rare cases; the user still sees the
    // permission-granted stream once interaction resumes playback.
  });

  const overlayCtx = refs.overlayCanvas.getContext('2d')!;
  const scratchCanvas = document.createElement('canvas');
  const scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;

  const track = stream.getVideoTracks()[0];

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

  // v2: keeps capturing instead of stopping after one shot, so moving
  // through the valid angle range builds up a set of shots to choose
  // from later in the gallery, capped so one sitting can't run away.
  const controller = new CaptureController((result) => {
    const stored: StoredCapture = {
      id: makeCaptureId(),
      blob: result.blob,
      offAxisDeg: result.metadata.offAxisDeg,
      offAxisVec: result.metadata.offAxisVec,
      rollDeg: result.metadata.rollDeg,
      mouthBoxWidth: result.metadata.mouthBoxWidth,
      mouthBoxHeight: result.metadata.mouthBoxHeight,
      exposureLockSuccess: result.metadata.exposureLockSuccess,
      captureMode: result.metadata.captureMode,
      capturedAt: result.metadata.capturedAt,
    };
    URL.revokeObjectURL(result.imageUrl);

    void saveCapture(stored).then(() => {
      sessionCaptureCount++;
      if (sessionCaptureCount >= MAX_SESSION_CAPTURES) sessionFull = true;
      updateSessionBadge();
    });
  });

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
    const clippedFraction = sampleClippedFraction(refs.video, trackerResult.mouthBox, scratchCtx);
    const evaluation = evaluateGates(
      { tracker: trackerResult, clippedFraction, nowMs: now },
      gateState,
    );
    gateState = evaluation.state;

    if (!sessionFull) {
      controller.handleFrame(
        now,
        evaluation,
        {
          offAxisDeg: trackerResult.offAxisDeg,
          offAxisVec: trackerResult.offAxisVec,
          rollDeg: trackerResult.rollDeg,
          mouthBox: trackerResult.mouthBox,
        },
        refs.video,
        track,
      );
    }

    drawOverlay(
      overlayCtx,
      refs.overlayCanvas.width,
      refs.overlayCanvas.height,
      trackerResult.mouthBox,
      controller.phase === 'processing' ? 'green' : evaluation.boxColor,
      evaluation.arrowDirection,
      controller.phase !== 'idle' ? controller.ringProgress : 0,
    );

    updatePromptUI(refs, evaluation, controller.phase, sessionFull);

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

function updatePromptUI(
  refs: ViewfinderRefs,
  evaluation: GateEvaluation,
  phase: 'idle' | 'ring' | 'processing',
  sessionFull: boolean,
): void {
  refs.promptBanner.classList.remove('optimal');

  if (sessionFull) {
    refs.promptBanner.textContent = 'Gallery full';
    refs.promptBanner.classList.remove('hidden');
    refs.holdProgress.textContent = 'Tap Done to review';
    return;
  }

  if (phase === 'processing') {
    refs.promptBanner.classList.add('hidden');
    refs.holdProgress.textContent = 'Capturing';
    return;
  }

  if (evaluation.prompt) {
    refs.promptBanner.textContent = evaluation.prompt;
    refs.promptBanner.classList.remove('hidden');
  } else if (evaluation.allPassed) {
    refs.promptBanner.textContent = 'Optimal';
    refs.promptBanner.classList.add('optimal');
    refs.promptBanner.classList.remove('hidden');
  } else {
    refs.promptBanner.classList.add('hidden');
  }

  refs.holdProgress.textContent = phase === 'ring' ? 'Hold still' : '';
}

main();
