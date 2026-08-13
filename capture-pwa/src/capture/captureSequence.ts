import { CAPTURE_MODE, CAPTURE_SEQUENCE } from '../config';
import { releaseLock, tryLockCapture } from './deviceCamera';
import { captureAndScoreFrame } from './frameScore';

export interface CaptureMetadata {
  offAxisDeg: number;
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
  rollDeg: number;
  mouthBox: { w: number; h: number } | null;
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
  const exposureLockSuccess = await tryLockCapture(track);
  await sleep(CAPTURE_SEQUENCE.sensorSettleMs);

  const width = video.videoWidth;
  const height = video.videoHeight;
  const interval = CAPTURE_SEQUENCE.burstDurationMs / CAPTURE_SEQUENCE.burstFrameCount;

  const frames = [];
  for (let i = 0; i < CAPTURE_SEQUENCE.burstFrameCount; i++) {
    frames.push(await captureAndScoreFrame(video, width, height));
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
      rollDeg: snapshot.rollDeg,
      mouthBoxWidth: snapshot.mouthBox?.w ?? 0,
      mouthBoxHeight: snapshot.mouthBox?.h ?? 0,
      exposureLockSuccess,
      deviceModel: navigator.userAgent,
      capturedAt: new Date().toISOString(),
      captureMode: CAPTURE_MODE,
      framesCaptured: CAPTURE_SEQUENCE.burstFrameCount,
      framesKept: kept.length,
    },
  };
}
