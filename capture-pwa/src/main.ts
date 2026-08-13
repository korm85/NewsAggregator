import { renderPermissionScreen } from './ui/permissionScreen';
import { renderDeniedScreen } from './ui/deniedScreen';
import { renderLoadingScreen } from './ui/loadingScreen';
import { renderViewfinderScreen, type ViewfinderRefs } from './ui/viewfinderScreen';
import { renderGalleryScreen } from './ui/galleryScreen';
import { drawLipDots } from './ui/overlay';
import { MediaPipeTracker } from './tracker/mediapipeTracker';
import type { TrackerResult } from './tracker/types';
import { runCaptureSequence, type TrackerSnapshot } from './capture/captureSequence';
import {
  CameraPermissionError,
  isTorchSupported,
  setTorch,
  startCamera,
  stopCamera,
} from './capture/deviceCamera';
import { saveCapture, type StoredCapture } from './storage/captureStore';
import { CAPTURE_MODE, MAX_SESSION_CAPTURES, THRESHOLDS } from './config';

const root = document.getElementById('app')!;

let stream: MediaStream | null = null;
let tracker: MediaPipeTracker | null = null;
let loopActive = false;
/** Which camera is active right now. Starts from config's default, but
 * can change at runtime via the Switch button (unlike v1/v2, this is no
 * longer fixed for the life of the app). */
let currentFacingMode: 'front' | 'rear' = CAPTURE_MODE;

async function main(): Promise<void> {
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
  let switchingCamera = false;
  let torchOn = false;
  let angleOptimal = false;
  let latestSnapshot: TrackerSnapshot | null = null;

  const goToGallery = () => {
    loopActive = false;
    void renderGalleryScreen(root, startViewfinder);
  };

  const refs = renderViewfinderScreen(root, currentFacingMode === 'front', {
    onDone: goToGallery,
    onCapture: onCaptureTapped,
    onSwitchCamera: onSwitchCameraTapped,
    onToggleTorch: onToggleTorchTapped,
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

  function onCaptureTapped(): void {
    if (capturing || switchingCamera || !latestSnapshot || sessionCaptureCount >= MAX_SESSION_CAPTURES) return;
    capturing = true;
    refs.captureButton.disabled = true;
    refs.captureButton.textContent = '...';
    refs.switchCameraButton.disabled = true;

    runCaptureSequence(refs.video, track, latestSnapshot, currentFacingMode)
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

    // Don't fight the "capturing"/"switching"/"full" disabled states the
    // click handlers set while something's already in flight.
    if (!capturing && !switchingCamera && sessionCaptureCount < MAX_SESSION_CAPTURES) {
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
