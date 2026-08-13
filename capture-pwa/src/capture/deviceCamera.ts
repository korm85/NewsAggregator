import { CAPTURE_MODE } from '../config';

export class CameraPermissionError extends Error {
  constructor(public readonly cause: unknown) {
    super('Camera permission denied or unavailable');
  }
}

export async function startCamera(): Promise<MediaStream> {
  const facingMode = CAPTURE_MODE === 'front' ? 'user' : 'environment';
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode,
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });
  } catch (err) {
    throw new CameraPermissionError(err);
  }
}

export function stopCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * exposureMode/whiteBalanceMode/focusMode are real, shipping constraints
 * on Chrome/Android but are not part of TypeScript's lib.dom.d.ts, so
 * this narrow extension is needed to call applyConstraints with them at
 * all (handoff Section 9's platform degradation note: Safari does not
 * expose these, applyConstraints will just fail there and we fall back
 * to auto).
 */
interface ManualCaptureCapabilities extends MediaTrackCapabilities {
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  focusMode?: string[];
}

interface ManualCaptureConstraints extends MediaTrackConstraintSet {
  exposureMode?: string;
  whiteBalanceMode?: string;
  focusMode?: string;
}

function getManualCapabilities(track: MediaStreamTrack): ManualCaptureCapabilities | undefined {
  return track.getCapabilities?.() as ManualCaptureCapabilities | undefined;
}

/**
 * Handoff Section 9: attempt manual exposure/white-balance/focus lock
 * before capture. Returns whether the lock actually took, so the
 * UI/metadata can record which frames were captured under locked vs
 * auto conditions.
 */
export async function tryLockCapture(track: MediaStreamTrack): Promise<boolean> {
  const capabilities = getManualCapabilities(track);
  if (!capabilities) return false;

  const constraints: ManualCaptureConstraints = {};
  if (capabilities.exposureMode?.includes('manual')) constraints.exposureMode = 'manual';
  if (capabilities.whiteBalanceMode?.includes('manual')) constraints.whiteBalanceMode = 'manual';
  if (capabilities.focusMode?.includes('manual')) constraints.focusMode = 'manual';

  if (Object.keys(constraints).length === 0) return false;

  try {
    await track.applyConstraints({ advanced: [constraints] });
    return true;
  } catch {
    return false;
  }
}

export async function releaseLock(track: MediaStreamTrack): Promise<void> {
  const capabilities = getManualCapabilities(track);
  if (!capabilities) return;

  const constraints: ManualCaptureConstraints = {};
  if (capabilities.exposureMode?.includes('continuous')) constraints.exposureMode = 'continuous';
  if (capabilities.whiteBalanceMode?.includes('continuous')) constraints.whiteBalanceMode = 'continuous';
  if (capabilities.focusMode?.includes('continuous')) constraints.focusMode = 'continuous';
  if (Object.keys(constraints).length === 0) return;

  try {
    await track.applyConstraints({ advanced: [constraints] });
  } catch {
    // Best effort. Nothing to recover from if the browser refuses.
  }
}
