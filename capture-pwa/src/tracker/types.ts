/**
 * Layer 1 output contract (handoff Section 4). Nothing outside the
 * tracker/ directory may import MediaPipe types — every other layer
 * only ever sees this shape, so the tracking engine can be swapped
 * (e.g. for a commercial SDK) without touching gates or UI.
 */
export interface TrackerResult {
  detected: boolean;
  /** Normalized 0-1, padded and EMA-smoothed. Null when no face detected. */
  mouthBox: { x: number; y: number; w: number; h: number } | null;
  /** Combined yaw + pitch off the camera normal, degrees, always >= 0. */
  offAxisDeg: number;
  /** Signed unit-ish vector, camera-space x/y, for direction hints. */
  offAxisVec: { x: number; y: number };
  rollDeg: number;
  /**
   * Sum of outer-lip landmark pixel coordinates for the current frame.
   * The gate evaluator compares this against recent history to estimate
   * motion cheaply without carrying full landmark arrays across the
   * worker boundary. See config.ts THRESHOLDS.stability for how the
   * delta is interpreted.
   */
  landmarkChecksum: number;
}

export interface Tracker {
  init(): Promise<void>;
  /** Run detection on a single video frame at timestamp `nowMs`. */
  detect(video: HTMLVideoElement, nowMs: number): TrackerResult;
  dispose(): void;
}
