import { CAPTURE_SEQUENCE } from '../config';
import type { CardDetectionResult } from './cardDetector';
import { computeCardGuideRect, unionRect, type NormalizedRect } from './cardGuideRegion';
import { releaseLock, tryLockCapture } from './deviceCamera';
import { captureAndScoreFrame, type CropRect } from './frameScore';
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
  /** Data Storage spec: "the calibration card detection data, and the computed light source direction". */
  cardboardMode: boolean;
  card: CardDetectionResult | null;
  lightDirection: { x: number; y: number } | null;
  /**
   * The primary color-calibration artifact under the video-first
   * design: a full-frame clip recorded across the entire Active Sweep
   * window (see videoRecorder.ts), capturing multiple reflection angles
   * as the user slowly moves the camera. The offline post-processor
   * extracts angular telemetry and removes glare from this, more
   * accurately than the live browser tracker could -- the app itself
   * does not attempt either. Null when MediaRecorder is unsupported or
   * recording failed for any reason; a failure here never blocks the
   * still-image anchor below.
   */
  video: RecordedVideo | null;
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
 * Video-first "Active Sweep" capture. Runs after the gate evaluator has
 * held every active gate (pitch/yaw/roll/distance/smile, +card in
 * cardboard mode) passing for the required frame count -- i.e. the
 * geometry is strictly locked at the instant this fires. Two artifacts
 * come out of the ~5.5s window that follows:
 *
 * 1. A single uncompressed still, grabbed from the raw video track at
 *    the exact start of the window (before the user begins sweeping),
 *    so it reflects the strictly-gated starting geometry. Never sourced
 *    from MediaRecorder output (lossy) and never from the browser's
 *    native ImageCapture photo pipeline either -- ImageCapture applies
 *    its own hardware tone mapping that can't be undone, which is worse
 *    for a color-calibration anchor than the resolution it would gain.
 *    There is deliberately no multi-frame scoring/selection anymore:
 *    the downstream color algorithm doesn't need a perfect still, it
 *    needs the video below.
 * 2. A supplementary MediaRecorder clip, full camera frame (not cropped,
 *    see videoRecorder.ts), recording for the sweep's entire duration.
 *    This is now the primary color-calibration artifact: the multiple
 *    reflection angles the sweep produces let the offline post-
 *    processor extract angular telemetry and remove glare more
 *    accurately than the live browser tracker could. No highlight
 *    clipping/rejection is applied to it here -- every specular
 *    highlight is deliberately passed through unmodified.
 *
 * The live tracking loop is expected to be paused by the caller for
 * this entire window (see main.ts onFrame) -- both to avoid resource
 * contention with the recorder, and because nothing here consumes a
 * live tracking result once the still anchor is grabbed.
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

  // The uncompressed color anchor: grabbed now, before the sweep below
  // begins, so it's the strictly-gated starting frame, not an arbitrary
  // mid-sweep moment.
  const stillFrame = await captureAndScoreFrame(video, crop, overlayLines);

  // Records from the raw track for the sweep's full duration. A
  // failure to start returns null; the still anchor above is already
  // captured by this point regardless, so video is purely additive.
  const recording = startVideoRecording(track);
  await sleep(CAPTURE_SEQUENCE.burstDurationMs);
  const recordedVideo = recording ? await recording.stop().catch(() => null) : null;

  fireHaptics();
  playCaptureSound();

  await releaseLock(track);

  return {
    imageUrl: URL.createObjectURL(stillFrame.blob),
    blob: stillFrame.blob,
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
      cardboardMode: aux.cardboardMode,
      card: aux.card,
      lightDirection: aux.light?.direction2D ?? null,
      video: recordedVideo,
    },
  };
}
