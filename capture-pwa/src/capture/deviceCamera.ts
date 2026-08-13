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
 * exposureMode/whiteBalanceMode/focusMode (and their manual-value
 * counterparts) are real, shipping constraints on Chrome/Android but
 * are not part of TypeScript's lib.dom.d.ts, so this narrow extension
 * is needed to read/set them at all (handoff Section 9's platform
 * degradation note: Safari does not expose these, applyConstraints
 * will just fail there and we fall back to auto).
 */
interface ManualCaptureCapabilities extends MediaTrackCapabilities {
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  focusMode?: string[];
}

interface ManualCaptureSettings extends MediaTrackSettings {
  exposureTime?: number;
  colorTemperature?: number;
  focusDistance?: number;
}

interface ManualCaptureConstraints extends MediaTrackConstraintSet {
  exposureMode?: string;
  whiteBalanceMode?: string;
  focusMode?: string;
  exposureTime?: number;
  colorTemperature?: number;
  focusDistance?: number;
}

function getManualCapabilities(track: MediaStreamTrack): ManualCaptureCapabilities | undefined {
  return track.getCapabilities?.() as ManualCaptureCapabilities | undefined;
}

/**
 * Handoff Section 9: attempt manual exposure/white-balance/focus lock
 * before capture, so color and brightness don't shift mid-burst.
 *
 * Switching exposureMode to 'manual' without also supplying a value
 * does NOT mean "freeze at whatever auto currently has", it means "the
 * camera picks whatever manual default it wants", which on several
 * Android devices is a near-black default exposureTime, producing a
 * capture much darker than the live preview. The fix is to read the
 * current auto-computed value from getSettings() first and pass that
 * exact value as the manual constraint, only locking whichever of
 * exposure/white-balance/focus we can actually read a current value
 * for, leaving the rest on auto rather than risk an unset lock.
 */
export async function tryLockCapture(track: MediaStreamTrack): Promise<boolean> {
  const capabilities = getManualCapabilities(track);
  if (!capabilities) return false;

  const settings = track.getSettings?.() as ManualCaptureSettings | undefined;
  const constraints: ManualCaptureConstraints = {};

  if (capabilities.exposureMode?.includes('manual') && typeof settings?.exposureTime === 'number') {
    constraints.exposureMode = 'manual';
    constraints.exposureTime = settings.exposureTime;
  }
  if (capabilities.whiteBalanceMode?.includes('manual') && typeof settings?.colorTemperature === 'number') {
    constraints.whiteBalanceMode = 'manual';
    constraints.colorTemperature = settings.colorTemperature;
  }
  if (capabilities.focusMode?.includes('manual') && typeof settings?.focusDistance === 'number') {
    constraints.focusMode = 'manual';
    constraints.focusDistance = settings.focusDistance;
  }

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
