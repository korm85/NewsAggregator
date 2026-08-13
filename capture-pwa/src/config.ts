/**
 * Single source of truth for capture tuning. Every gate threshold and the
 * front/rear decision lives here so it can be tuned without hunting
 * through the codebase (handoff Section 7).
 */

/**
 * Config decision open per handoff Section 10: front camera (patient
 * self-capture) or rear camera (clinician/assistant capture)?
 * Rear gives materially better color data but front is the only option
 * for unassisted self-capture. Not blocking v1 on this: both paths are
 * implemented, this constant switches between them. Flagged in the PR.
 */
export const CAPTURE_MODE: 'front' | 'rear' = 'front';

/**
 * Front camera is shown mirrored (standard selfie convention). Rear is
 * not. Every mirroring decision (video CSS transform, overlay drawing,
 * left/right direction text and arrows) must read from this single
 * constant, never hardcode mirroring separately (handoff Section 8).
 */
export const MIRRORED = CAPTURE_MODE === 'front';

export interface RangeGateConfig {
  enterMin: number;
  enterMax: number;
  exitMin: number;
  exitMax: number;
}

export interface MaxGateConfig {
  enterMax: number;
  exitMax: number;
}

export const THRESHOLDS = {
  /** Mouth box width as a fraction of frame width. */
  distance: {
    enterMin: 0.3,
    enterMax: 0.4,
    exitMin: 0.29,
    exitMax: 0.41,
  } satisfies RangeGateConfig,

  /** Mouth box center offset from frame center, fraction of frame size. */
  centering: {
    enterMax: 0.06,
    exitMax: 0.072,
  } satisfies MaxGateConfig,

  /** Off-axis angle in degrees. Spec-mandated values: enter 15, exit 18. */
  angle: {
    enterMax: 15,
    exitMax: 18,
  } satisfies MaxGateConfig,

  /** Roll in degrees. */
  roll: {
    enterMax: 5,
    exitMax: 6,
  } satisfies MaxGateConfig,

  /**
   * Stability threshold in "checksum units" (see TrackerResult.landmarkChecksum).
   * The checksum is the sum of lip-landmark pixel coordinates; its
   * frame-to-frame delta divided by point count approximates mean
   * per-landmark pixel movement.
   */
  stability: {
    enterMax: 1.5,
    exitMax: 1.8,
  } satisfies MaxGateConfig,

  /** Fraction of mouth-box pixels clipped (>250 in any channel). */
  exposure: {
    enterMax: 0.005,
    exitMax: 0.006,
  } satisfies MaxGateConfig,

  /** Frames of history the gate evaluator keeps for stability + hold checks. */
  historyLength: 5,

  /** Consecutive all-pass frames required before the capture sequence fires. */
  holdFramesRequired: 5,

  /** Minimum time a prompt stays on screen before it can be replaced. */
  minPromptDisplayMs: 800,

  /** Mouth bounding-box padding, each side, as a fraction of box size. */
  mouthBoxPadding: 0.15,

  /** EMA smoothing factor for the mouth box across frames. */
  mouthBoxSmoothingAlpha: 0.3,
} as const;

export const CAPTURE_SEQUENCE = {
  ringFillMs: 400,
  sensorSettleMs: 500,
  burstFrameCount: 6,
  burstDurationMs: 400,
  keepBestCount: 3,
} as const;

/**
 * import.meta.env.BASE_URL reflects Vite's configured `base` (see
 * vite.config.ts): '/' in local dev, '/NewsAggregator/' when built for
 * GitHub Pages. Unlike asset references inside index.html/debug.html,
 * Vite does not rewrite plain string literals, so runtime path
 * constants must read this explicitly.
 */
const BASE = import.meta.env.BASE_URL;
export const MODEL_URL = `${BASE}models/face_landmarker.task`;
export const WASM_BASE_URL = `${BASE}wasm`;
