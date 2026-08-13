import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { MODEL_URL, THRESHOLDS, WASM_BASE_URL } from '../config';
import type { Tracker, TrackerResult } from './types';

/**
 * Outer lip contour landmark indices. This is the standard MediaPipe
 * FACEMESH_LIPS outer-ring connection loop
 * (61-146-91-181-84-17-314-405-321-375-291-409-270-269-267-0-37-39-40-185-61),
 * matching the set specified in the handoff. Verify visually against
 * /debug.html before trusting on a new MediaPipe model version.
 */
export const OUTER_LIP_INDICES = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0,
  37, 39, 40, 185,
];

const EMPTY_RESULT: TrackerResult = {
  detected: false,
  mouthBox: null,
  offAxisDeg: 0,
  offAxisVec: { x: 0, y: 0 },
  rollDeg: 0,
  landmarkChecksum: 0,
  lipPoints: null,
};

/**
 * Angle/roll sign convention, per handoff Section 5. NOT independently
 * verified against a live camera in this environment (no physical face
 * available to turn left/right during development) -- use /debug.html
 * with a real device before trusting direction prompts in the field.
 * If the convention below is wrong, flip the sign constants here; every
 * other layer reads offAxisVec, never the raw matrix.
 */
const SIGN_CONVENTION_VERIFIED = false;
// If /debug.html shows offAxisVec.x flipping the wrong way when turning
// your head, change these to -1 (per handoff Section 5's verification steps).
const X_SIGN = 1;
const Y_SIGN = 1;

export class MediaPipeTracker implements Tracker {
  private landmarker: FaceLandmarker | null = null;
  private smoothedBox: { x: number; y: number; w: number; h: number } | null = null;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    });
  }

  detect(video: HTMLVideoElement, nowMs: number): TrackerResult {
    if (!this.landmarker) return EMPTY_RESULT;
    if (video.videoWidth === 0 || video.videoHeight === 0) return EMPTY_RESULT;

    let result: FaceLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(video, nowMs);
    } catch {
      return EMPTY_RESULT;
    }

    const landmarks = result.faceLandmarks?.[0];
    const matrixData = result.facialTransformationMatrixes?.[0]?.data;
    if (!landmarks || !matrixData) {
      this.smoothedBox = null;
      return EMPTY_RESULT;
    }

    const { offAxisDeg, offAxisVec, rollDeg } = computeAngles(matrixData);
    const { box, checksum, points } = computeMouthBox(
      landmarks,
      video.videoWidth,
      video.videoHeight,
    );

    this.smoothedBox = smoothBox(this.smoothedBox, box, THRESHOLDS.mouthBoxSmoothingAlpha);

    return {
      detected: true,
      mouthBox: this.smoothedBox,
      offAxisDeg,
      offAxisVec,
      rollDeg,
      landmarkChecksum: checksum,
      lipPoints: points,
    };
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.smoothedBox = null;
  }
}

export function computeAngles(m: Float32Array | number[]) {
  // m is 16 floats, column-major. Column 2 is the face forward axis in
  // camera space (handoff Section 5).
  const fx = m[8];
  const fy = m[9];
  const fz = m[10];
  const n = Math.hypot(fx, fy, fz) || 1;

  const offAxisDeg = (Math.acos(Math.min(1, Math.abs(fz) / n)) * 180) / Math.PI;

  const offAxisVec = { x: (X_SIGN * fx) / n, y: (Y_SIGN * fy) / n };

  // Column 1 is the face up axis.
  const rollDeg = (Math.atan2(m[4], m[5]) * 180) / Math.PI;

  return { offAxisDeg, offAxisVec, rollDeg };
}

function computeMouthBox(
  landmarks: { x: number; y: number }[],
  videoWidth: number,
  videoHeight: number,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let checksum = 0;
  const points: { x: number; y: number }[] = [];

  for (const idx of OUTER_LIP_INDICES) {
    const lm = landmarks[idx];
    if (!lm) continue;
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
    checksum += lm.x * videoWidth + lm.y * videoHeight;
    points.push({ x: lm.x, y: lm.y });
  }

  const rawW = maxX - minX;
  const rawH = maxY - minY;
  const pad = THRESHOLDS.mouthBoxPadding;

  const box = {
    x: minX - rawW * pad,
    y: minY - rawH * pad,
    w: rawW * (1 + 2 * pad),
    h: rawH * (1 + 2 * pad),
  };

  return { box, checksum, points };
}

function smoothBox(
  prev: { x: number; y: number; w: number; h: number } | null,
  next: { x: number; y: number; w: number; h: number },
  alpha: number,
) {
  if (!prev) return next;
  return {
    x: prev.x + alpha * (next.x - prev.x),
    y: prev.y + alpha * (next.y - prev.y),
    w: prev.w + alpha * (next.w - prev.w),
    h: prev.h + alpha * (next.h - prev.h),
  };
}
