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
   * Signed horizontal deviation of the face-forward vector from the
   * camera's optical axis, degrees. Derived from the same forward
   * vector as offAxisDeg/offAxisVec (see mediapipeTracker.ts), not from
   * decomposing the rotation matrix into an Euler sequence, that's the
   * ambiguous operation the handoff explicitly warns against. Resolving
   * one already-trusted 3D vector into two angular components against a
   * fixed reference axis has no rotation-order ambiguity the way a
   * 3-axis matrix decomposition does.
   */
  yawDeg: number;
  /** Signed vertical deviation of the face-forward vector, degrees. Same derivation note as yawDeg. */
  pitchDeg: number;
  /**
   * Mouth Aspect Ratio: inner-lip vertical gap divided by mouth width,
   * in pixel space. Same family of metric as the classic Eye Aspect
   * Ratio used for blink detection, here used to tell a closed/half
   * smile from one wide enough to show teeth.
   */
  mar: number;
  /**
   * Sum of outer-lip landmark pixel coordinates for the current frame.
   * The gate evaluator compares this against recent history to estimate
   * motion cheaply without carrying full landmark arrays across the
   * worker boundary. See config.ts THRESHOLDS.stability for how the
   * delta is interpreted.
   */
  landmarkChecksum: number;
  /**
   * Normalized 0-1 outer-lip contour points, for drawing guide dots on
   * the live view (same idea as /debug.html). Generic {x,y} pairs, not
   * a MediaPipe type, so this stays engine-agnostic. Null when no face
   * detected.
   */
  lipPoints: { x: number; y: number }[] | null;
}

export interface Tracker {
  init(): Promise<void>;
  /** Run detection on a single video frame at timestamp `nowMs`. */
  detect(video: HTMLVideoElement, nowMs: number): TrackerResult;
  dispose(): void;
}
