import { CAPTURE_SEQUENCE } from '../config';
import type { CardDetectionResult } from './cardDetector';
import { computeCardGuideRect, unionRect } from './cardGuideRegion';
import { releaseLock, tryLockCapture } from './deviceCamera';
import { captureAndScoreFrame, type CropRect } from './frameScore';
import type { LightEstimate } from './lightEstimator';

export interface CaptureMetadata {
  offAxisDeg: number;
  offAxisVec: { x: number; y: number };
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  mar: number;
  smileWidthRatio: number;
  mouthBoxWidth: number;
  mouthBoxHeight: number;
  exposureLockSuccess: boolean;
  deviceModel: string;
  capturedAt: string;
  captureMode: 'front' | 'rear';
  framesCaptured: number;
  framesKept: number;
  /** Data Storage spec: "the calibration card detection data, and the computed light source direction". */
  cardboardMode: boolean;
  card: CardDetectionResult | null;
  lightDirection: { x: number; y: number } | null;
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
  pitchDeg: number;
  yawDeg: number;
  mar: number;
  smileWidthRatio: number;
  mouthBox: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Auxiliary calibration data available at the moment capture fires,
 * gathered separately from the tracker (card detection needs a
 * full-frame sample, not the mouth-cropped region the tracker works
 * from). Both fields are null when cardboardMode is off or no card has
 * been detected yet.
 */
export interface AuxCaptureData {
  cardboardMode: boolean;
  card: CardDetectionResult | null;
  light: LightEstimate | null;
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
 * Same numbers the live view shows, burned into the saved image itself
 * so the pose data travels with the photo (v2: "save the data you show
 * in debug mode as an image"), extended with the Smart Frame spec's
 * pitch/yaw split, MAR, and (when relevant) card status.
 */
function buildOverlayLines(
  snapshot: TrackerSnapshot,
  capturedAt: string,
  aux: AuxCaptureData,
): string[] {
  const lines = [
    `pitchDeg: ${snapshot.pitchDeg.toFixed(2)}  yawDeg: ${snapshot.yawDeg.toFixed(2)}`,
    `rollDeg: ${snapshot.rollDeg.toFixed(2)}  mar: ${snapshot.mar.toFixed(3)}`,
    `smileWidthRatio: ${snapshot.smileWidthRatio.toFixed(2)}`,
  ];
  if (aux.cardboardMode) {
    const cardText = aux.card
      ? `card: ${aux.card.allMarkersVisible ? 'visible' : 'incomplete'}, ${aux.card.isFlat ? 'flat' : 'tilted'}`
      : 'card: not detected';
    lines.push(cardText);
  }
  lines.push(capturedAt);
  return lines;
}

/**
 * The saved image is cropped to the mouth bounding box (the same box
 * the tracker computes, padded 15%), not the full camera frame, per
 * "I don't need all the face." When cardboardMode is on, the crop
 * expands to also include the on-screen card guide region (see
 * cardGuideRegion.ts): without this, a "with cardboard" capture would
 * still save a mouth-only crop that excludes the card entirely, even
 * though the whole point of that mode is a photo with the card in it
 * for color calibration, not just card detection numbers in the
 * metadata. Clamped to the video's actual pixel bounds since the
 * normalized region can extend slightly past the frame edge. Falls
 * back to the full frame if no box was available at capture time
 * (shouldn't happen, the shutter button is disabled without a detected
 * face, but a snapshot with a null box must not crash the capture).
 */
function computeCropRect(
  mouthBox: TrackerSnapshot['mouthBox'],
  videoWidth: number,
  videoHeight: number,
  includeCardGuide: boolean,
): CropRect {
  if (!mouthBox) return { x: 0, y: 0, w: videoWidth, h: videoHeight };

  const region = includeCardGuide ? unionRect(mouthBox, computeCardGuideRect(mouthBox)) : mouthBox;

  const rawX = region.x * videoWidth;
  const rawY = region.y * videoHeight;
  const rawW = region.w * videoWidth;
  const rawH = region.h * videoHeight;

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
  captureMode: 'front' | 'rear',
  aux: AuxCaptureData,
): Promise<CaptureResult> {
  const capturedAt = new Date().toISOString();
  const overlayLines = buildOverlayLines(snapshot, capturedAt, aux);
  const crop = computeCropRect(snapshot.mouthBox, video.videoWidth, video.videoHeight, aux.cardboardMode);

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
      pitchDeg: snapshot.pitchDeg,
      yawDeg: snapshot.yawDeg,
      mar: snapshot.mar,
      smileWidthRatio: snapshot.smileWidthRatio,
      mouthBoxWidth: snapshot.mouthBox?.w ?? 0,
      mouthBoxHeight: snapshot.mouthBox?.h ?? 0,
      exposureLockSuccess,
      deviceModel: navigator.userAgent,
      capturedAt,
      captureMode,
      framesCaptured: CAPTURE_SEQUENCE.burstFrameCount,
      framesKept: kept.length,
      cardboardMode: aux.cardboardMode,
      card: aux.card,
      lightDirection: aux.light?.direction2D ?? null,
    },
  };
}
