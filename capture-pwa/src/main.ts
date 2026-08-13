import { renderPermissionScreen } from './ui/permissionScreen';
import { renderDeniedScreen } from './ui/deniedScreen';
import { renderLoadingScreen } from './ui/loadingScreen';
import { renderViewfinderScreen, type ViewfinderRefs } from './ui/viewfinderScreen';
import { renderGalleryScreen } from './ui/galleryScreen';
import { drawLipDots } from './ui/overlay';
import { MediaPipeTracker } from './tracker/mediapipeTracker';
import type { TrackerResult } from './tracker/types';
import { runCaptureSequence, type TrackerSnapshot } from './capture/captureSequence';
import { startCamera, CameraPermissionError } from './capture/deviceCamera';
import { saveCapture, type StoredCapture } from './storage/captureStore';
import { MAX_SESSION_CAPTURES, THRESHOLDS } from './config';

const root = document.getElementById('app')!;

let stream: MediaStream | null = null;
let tracker: MediaPipeTracker | null = null;
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

/**
 * Preliminary-release view: shows the same live numbers /debug.html
 * does (this is deliberately the "debug view" the guided box+prompt UI
 * was replaced with, it read faster and clearer), plus a manual shutter
 * button. Capture is user-triggered now, not auto-fired off a held
 * gate state; angle hysteresis (config.ts THRESHOLDS.angle) still
 * drives the green "Optimal" signal so there's still a clear go/no-go
 * cue, but it no longer gates whether the button works.
 */
function startViewfinder(): void {
  if (!stream || !tracker) return;

  loopActive = true;
  let sessionCaptureCount = 0;
  let capturing = false;
  let angleOptimal = false;
  let latestSnapshot: TrackerSnapshot | null = null;

  const goToGallery = () => {
    loopActive = false;
    void renderGalleryScreen(root, startViewfinder);
  };

  const refs = renderViewfinderScreen(root, goToGallery, onCaptureTapped);
  refs.video.srcObject = stream;
  refs.video.play().catch(() => {
    // Autoplay can be blocked in rare cases; the user still sees the
    // permission-granted stream once interaction resumes playback.
  });

  const overlayCtx = refs.overlayCanvas.getContext('2d')!;
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

  function onCaptureTapped(): void {
    if (capturing || !latestSnapshot || sessionCaptureCount >= MAX_SESSION_CAPTURES) return;
    capturing = true;
    refs.captureButton.disabled = true;
    refs.captureButton.textContent = '...';

    runCaptureSequence(refs.video, track, latestSnapshot)
      .then((result) => {
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
      });
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
      angleOptimal = angleOptimal
        ? trackerResult.offAxisDeg <= THRESHOLDS.angle.exitMax
        : trackerResult.offAxisDeg <= THRESHOLDS.angle.enterMax;
      latestSnapshot = {
        offAxisDeg: trackerResult.offAxisDeg,
        offAxisVec: trackerResult.offAxisVec,
        rollDeg: trackerResult.rollDeg,
        mouthBox: trackerResult.mouthBox,
      };
    } else {
      angleOptimal = false;
      latestSnapshot = null;
    }

    overlayCtx.clearRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height);
    drawLipDots(
      overlayCtx,
      refs.overlayCanvas.width,
      refs.overlayCanvas.height,
      trackerResult.lipPoints,
      angleOptimal ? '#22c55e' : '#f59e0b',
    );

    updateReadout(refs, trackerResult, angleOptimal);

    // Don't fight the "capturing"/"full" disabled states the click
    // handler sets while a capture is in flight or the session is capped.
    if (!capturing && sessionCaptureCount < MAX_SESSION_CAPTURES) {
      refs.captureButton.disabled = !trackerResult.detected;
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

function updateReadout(refs: ViewfinderRefs, tr: TrackerResult, optimal: boolean): void {
  refs.liveReadout.classList.remove('optimal', 'none');

  if (!tr.detected) {
    refs.liveReadout.textContent = 'No face detected';
    refs.liveReadout.classList.add('none');
    return;
  }

  const status = optimal ? '  OPTIMAL' : '';
  refs.liveReadout.textContent =
    `offAxisDeg: ${tr.offAxisDeg.toFixed(2)}${status}\n` +
    `offAxisVec: x=${tr.offAxisVec.x.toFixed(3)} y=${tr.offAxisVec.y.toFixed(3)}\n` +
    `rollDeg: ${tr.rollDeg.toFixed(2)}`;
  if (optimal) refs.liveReadout.classList.add('optimal');
}

main();
