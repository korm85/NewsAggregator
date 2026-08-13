import { renderPermissionScreen } from './ui/permissionScreen';
import { renderDeniedScreen } from './ui/deniedScreen';
import { renderLoadingScreen } from './ui/loadingScreen';
import { renderViewfinderScreen, type ViewfinderRefs } from './ui/viewfinderScreen';
import { renderResultScreen } from './ui/resultScreen';
import { drawOverlay } from './ui/overlay';
import { MediaPipeTracker } from './tracker/mediapipeTracker';
import { evaluateGates } from './gates/gateEvaluator';
import { createInitialGateState, type GateEvaluation, type GateState } from './gates/types';
import { sampleClippedFraction } from './capture/exposureSample';
import { CaptureController } from './capture/captureController';
import { startCamera, CameraPermissionError } from './capture/deviceCamera';

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

function startViewfinder(): void {
  if (!stream || !tracker) return;

  gateState = createInitialGateState();
  loopActive = true;

  const refs = renderViewfinderScreen(root);
  refs.video.srcObject = stream;
  refs.video.play().catch(() => {
    // Autoplay can be blocked in rare cases; the user still sees the
    // permission-granted stream once interaction resumes playback.
  });

  const overlayCtx = refs.overlayCanvas.getContext('2d')!;
  const scratchCanvas = document.createElement('canvas');
  const scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;

  const track = stream.getVideoTracks()[0];

  const controller = new CaptureController((result) => {
    loopActive = false;
    renderResultScreen(root, result, () => {
      URL.revokeObjectURL(result.imageUrl);
      startViewfinder();
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

    controller.handleFrame(
      now,
      evaluation,
      {
        offAxisDeg: trackerResult.offAxisDeg,
        rollDeg: trackerResult.rollDeg,
        mouthBox: trackerResult.mouthBox,
      },
      refs.video,
      track,
    );

    drawOverlay(
      overlayCtx,
      refs.overlayCanvas.width,
      refs.overlayCanvas.height,
      trackerResult.mouthBox,
      controller.phase === 'processing' ? 'green' : evaluation.boxColor,
      evaluation.arrowDirection,
      controller.phase !== 'idle' ? controller.ringProgress : 0,
    );

    updatePromptUI(refs, evaluation, controller.phase);

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
): void {
  if (phase === 'processing') {
    refs.promptBanner.classList.add('hidden');
    refs.holdProgress.textContent = 'Capturing';
    return;
  }

  if (evaluation.prompt) {
    refs.promptBanner.textContent = evaluation.prompt;
    refs.promptBanner.classList.remove('hidden');
  } else {
    refs.promptBanner.classList.add('hidden');
  }

  refs.holdProgress.textContent = phase === 'ring' ? 'Hold still' : '';
}

main();
