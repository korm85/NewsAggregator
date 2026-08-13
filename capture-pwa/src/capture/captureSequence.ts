import { CAPTURE_SEQUENCE } from '../config';
import type { CardDetectionResult } from './cardDetector';
import { computeCardGuideRect, unionRect, type NormalizedRect } from './cardGuideRegion';
import { releaseLock, tryLockCapture } from './deviceCamera';
import { captureAndScoreFrame, cropAndOverlayBlob, type CropRect } from './frameScore';
import { takeHighResPhoto } from './imageCapture';
import type { LightEstimate } from './lightEstimator';
import { startVideoRecording, type RecordedVideo } from './videoRecorder';

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
  /**
   * Supplementary video clip recorded concurrently with the raw-frame
   * burst, full camera frame (see videoRecorder.ts for why it isn't
   * cropped). Null when MediaRecorder is unsupported or recording
   * failed, never used for color/shade measurement.
   */
  video: RecordedVideo | null;
  /**
   * Which pipeline produced the saved still. 'imageCapture' means the
   * browser's dedicated photo pipeline was used (higher resolution
   * than the live video stream, Chrome/Android only, see
   * imageCapture.ts); 'canvas' is the original scored-video-frame
   * path, used whenever ImageCapture is unsupported (all of iOS/
   * Safari today) or fails for any reason. Recorded so real-world
   * quality/reliability per platform can be judged later.
   */
  stillSource: 'imageCapture' | 'canvas';
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
 * The normalized (0-1) region the still image gets cropped to: the
 * mouth bounding box (the same box the tracker computes, padded 15%),
 * expanded to also include the on-screen card guide region when
 * cardboardMode is on (see cardGuideRegion.ts) so a "with cardboard"
 * capture doesn't exclude the card the clinician was guided to hold
 * there. Falls back to the full frame if no box was available at
 * capture time (shouldn't happen, the shutter button is disabled
 * without a detected face, but a snapshot with a null box must not
 * crash the capture). A separate function from the pixel-space crop
 * below (computeCropRect) purely so the normalized region is available
 * on its own before pixel conversion, not because anything outside
 * this file currently needs it.
 */
function computeNormalizedCropRegion(
  mouthBox: TrackerSnapshot['mouthBox'],
  includeCardGuide: boolean,
): NormalizedRect {
  if (!mouthBox) return { x: 0, y: 0, w: 1, h: 1 };
  return includeCardGuide ? unionRect(mouthBox, computeCardGuideRect(mouthBox)) : mouthBox;
}

/**
 * Pixel-space crop for the still image, per "I don't need all the
 * face." Clamped to the video's actual pixel bounds since the
 * normalized region can extend slightly past the frame edge.
 */
function computeCropRect(region: NormalizedRect, videoWidth: number, videoHeight: number): CropRect {
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
 * finished filling. The still image's frames are drawn straight from
 * the raw video track to an OffscreenCanvas, never sourced from
 * MediaRecorder output (handoff Section 2, decision 3, still binding
 * for the measurement image). A separate, purely supplementary video
 * clip IS recorded via MediaRecorder concurrently (videoRecorder.ts) —
 * that's a different artifact serving a different purpose, not a
 * relaxation of the still-image constraint.
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
  const stillCropRect = computeNormalizedCropRegion(snapshot.mouthBox, aux.cardboardMode);
  const crop = computeCropRect(stillCropRect, video.videoWidth, video.videoHeight);

  const exposureLockSuccess = await tryLockCapture(track);
  await sleep(CAPTURE_SEQUENCE.sensorSettleMs);

  // Wraps the existing raw-frame burst below with the same 5-second
  // window, recorded from the raw track (see videoRecorder.ts on why
  // full-frame, not cropped). A failure to start returns null and the
  // burst proceeds exactly as before, video is purely supplementary.
  const recording = startVideoRecording(track);

  const interval = CAPTURE_SEQUENCE.burstDurationMs / CAPTURE_SEQUENCE.burstFrameCount;

  const frames = [];
  for (let i = 0; i < CAPTURE_SEQUENCE.burstFrameCount; i++) {
    frames.push(await captureAndScoreFrame(video, crop, overlayLines));
    if (i < CAPTURE_SEQUENCE.burstFrameCount - 1) await sleep(interval);
  }

  const recordedVideo = recording ? await recording.stop().catch(() => null) : null;

  frames.sort((a, b) => b.score - a.score);
  const kept = frames.slice(0, CAPTURE_SEQUENCE.keepBestCount);
  const best = kept[0];

  // Attempted only after the reflection-scanning burst above has
  // already picked its best moment, so this can't add latency to that
  // timing-sensitive loop. On success, the high-res photo replaces the
  // scored canvas frame as the saved still (cropped to the same region
  // so behavior stays consistent whether or not this path is
  // available); on any failure (including simply unsupported, e.g.
  // iOS/Safari today) bestBlob stays the existing canvas frame.
  const highResPhoto = await takeHighResPhoto(track);
  let bestBlob = best.blob;
  let stillSource: CaptureMetadata['stillSource'] = 'canvas';
  if (highResPhoto) {
    try {
      bestBlob = await cropAndOverlayBlob(highResPhoto, stillCropRect, overlayLines);
      stillSource = 'imageCapture';
    } catch {
      // Decoding/cropping the high-res photo failed; keep the canvas frame.
    }
  }

  fireHaptics();
  playCaptureSound();

  await releaseLock(track);

  return {
    imageUrl: URL.createObjectURL(bestBlob),
    blob: bestBlob,
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
      video: recordedVideo,
      stillSource,
    },
  };
}
