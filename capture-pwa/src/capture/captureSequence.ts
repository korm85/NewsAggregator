import { CAPTURE_MODE, CAPTURE_SEQUENCE } from '../config';
import { releaseLock, tryLockCapture } from './deviceCamera';
import { captureAndScoreFrame, type CropRect } from './frameScore';

export interface CaptureMetadata {
  offAxisDeg: number;
  offAxisVec: { x: number; y: number };
  rollDeg: number;
  mouthBoxWidth: number;
  mouthBoxHeight: number;
  exposureLockSuccess: boolean;
  deviceModel: string;
  capturedAt: string;
  captureMode: 'front' | 'rear';
  framesCaptured: number;
  framesKept: number;
}

export interface CaptureResult {
  imageUrl: string;
  blob: Blob;
  metadata: CaptureMetadata;
}

export interface TrackerSnapshot {
  offAxisDeg: number;
  offAxisVec: { x: number; y: number };
  rollDeg: number;
  mouthBox: { x: number; y: number; w: number; h: number } | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fireHaptics(): void {
  if ('vibrate' in navigator) navigator.vibrate(60);
}

function playCaptureSound(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => void ctx.close();
  } catch {
    // Audio unavailable; the haptic pulse above is the fallback per
    // handoff Section 9 step 6 ("do not rely on a visual confirmation alone").
  }
}

/**
 * Same numbers /debug.html shows live, burned into the saved image
 * itself so the pose data travels with the photo (v2: "save the data
 * you show in debug mode as an image").
 */
function buildOverlayLines(snapshot: TrackerSnapshot, capturedAt: string): string[] {
  return [
    `offAxisDeg: ${snapshot.offAxisDeg.toFixed(2)}`,
    `offAxisVec: x=${snapshot.offAxisVec.x.toFixed(3)} y=${snapshot.offAxisVec.y.toFixed(3)}`,
    `rollDeg: ${snapshot.rollDeg.toFixed(2)}`,
    capturedAt,
  ];
}

/**
 * The saved image is cropped to the mouth bounding box (the same box
 * the tracker computes, padded 15%), not the full camera frame, per
 * "I don't need all the face." Clamped to the video's actual pixel
 * bounds since the normalized box can extend slightly past the frame
 * edge. Falls back to the full frame if no box was available at
 * capture time (shouldn't happen, the shutter button is disabled
 * without a detected face, but a snapshot with a null box must not
 * crash the capture).
 */
function computeCropRect(
  mouthBox: TrackerSnapshot['mouthBox'],
  videoWidth: number,
  videoHeight: number,
): CropRect {
  if (!mouthBox) return { x: 0, y: 0, w: videoWidth, h: videoHeight };

  const rawX = mouthBox.x * videoWidth;
  const rawY = mouthBox.y * videoHeight;
  const rawW = mouthBox.w * videoWidth;
  const rawH = mouthBox.h * videoHeight;

  const x1 = Math.max(0, rawX);
  const y1 = Math.max(0, rawY);
  const x2 = Math.min(videoWidth, rawX + rawW);
  const y2 = Math.min(videoHeight, rawY + rawH);

  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

/**
 * Handoff Section 9. Runs after the gate evaluator has held all gates
 * passing for the required frame count and the on-screen ring has
 * finished filling. Every captured frame is drawn straight from the raw
 * video track to an OffscreenCanvas, never sourced from MediaRecorder
 * output (handoff Section 2, decision 3).
 */
export async function runCaptureSequence(
  video: HTMLVideoElement,
  track: MediaStreamTrack,
  snapshot: TrackerSnapshot,
): Promise<CaptureResult> {
  const capturedAt = new Date().toISOString();
  const overlayLines = buildOverlayLines(snapshot, capturedAt);
  const crop = computeCropRect(snapshot.mouthBox, video.videoWidth, video.videoHeight);

  const exposureLockSuccess = await tryLockCapture(track);
  await sleep(CAPTURE_SEQUENCE.sensorSettleMs);

  const interval = CAPTURE_SEQUENCE.burstDurationMs / CAPTURE_SEQUENCE.burstFrameCount;

  const frames = [];
  for (let i = 0; i < CAPTURE_SEQUENCE.burstFrameCount; i++) {
    frames.push(await captureAndScoreFrame(video, crop, overlayLines));
    if (i < CAPTURE_SEQUENCE.burstFrameCount - 1) await sleep(interval);
  }

  frames.sort((a, b) => b.score - a.score);
  const kept = frames.slice(0, CAPTURE_SEQUENCE.keepBestCount);
  const best = kept[0];

  fireHaptics();
  playCaptureSound();

  await releaseLock(track);

  return {
    imageUrl: URL.createObjectURL(best.blob),
    blob: best.blob,
    metadata: {
      offAxisDeg: snapshot.offAxisDeg,
      offAxisVec: snapshot.offAxisVec,
      rollDeg: snapshot.rollDeg,
      mouthBoxWidth: snapshot.mouthBox?.w ?? 0,
      mouthBoxHeight: snapshot.mouthBox?.h ?? 0,
      exposureLockSuccess,
      deviceModel: navigator.userAgent,
      capturedAt,
      captureMode: CAPTURE_MODE,
      framesCaptured: CAPTURE_SEQUENCE.burstFrameCount,
      framesKept: kept.length,
    },
  };
}
