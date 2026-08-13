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

/** Opposite of MaxGateConfig: must be AT LEAST this value to pass, exit band is lower than enter. */
export interface MinGateConfig {
  enterMin: number;
  exitMin: number;
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

  /**
   * Separate pitch/yaw thresholds (Smart Frame spec: max 15 degrees
   * variance on each axis independently, not the combined offAxisDeg
   * cone). Both gates use abs(pitchDeg)/abs(yawDeg).
   */
  pitch: {
    enterMax: 15,
    exitMax: 18,
  } satisfies MaxGateConfig,
  yaw: {
    enterMax: 15,
    exitMax: 18,
  } satisfies MaxGateConfig,

  /** Roll in degrees. */
  roll: {
    enterMax: 5,
    exitMax: 6,
  } satisfies MaxGateConfig,

  /**
   * MAR is a mouth-OPEN floor only, not the "smiling wide" signal (see
   * smileWidth below and the note on TrackerResult.mar). Low on purpose:
   * a real wide smile with the teeth rows close together scored mar
   * 0.248, confirmed on-device, so this only needs to rule out a
   * literally closed mouth, not require a mouth-agape expression.
   */
  smileMar: {
    enterMin: 0.08,
    exitMin: 0.05,
  } satisfies MinGateConfig,

  /**
   * Mouth width / interocular distance. The actual "smiling wide"
   * signal, replacing MAR as primary after MAR was confirmed on-device
   * to reject a valid wide smile (mar 0.248, teeth clearly visible,
   * rows just touching) while accepting a mouth-agape expression (mar
   * 0.784) as no more "smiling" than the rejected one. Still a
   * placeholder, not calibrated against a bank of real smile photos
   * across different face shapes: the first placeholder (1.2/1.05) was
   * confirmed on-device to still require an exaggerated stretch to
   * pass, so this is lowered with real headroom. 1.0 keeps failing a
   * genuinely narrow/resting mouth (the smartFrameEvaluator.test.ts
   * "must fail" case is 0.9) while roughly halving the stretch the old
   * 1.2 required. Expect another retune once there's real calibration
   * data (smileWidthRatio is already burned into every saved image and
   * shown live, see mediapipeTracker.ts).
   */
  smileWidth: {
    enterMin: 1.0,
    exitMin: 0.9,
  } satisfies MinGateConfig,

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
  /**
   * Smart Frame spec: 5 seconds "to manage reflections". Sampled as raw
   * canvas frames across the window (never MediaRecorder-encoded video,
   * see handoff Section 2 decision 3 on why: 8-bit lossy 4:2:0 encoding
   * would corrupt the color data this product measures), scored the
   * same way the original short burst was, so the frame that ends up
   * saved has no specular reflection instead of just being sharp.
   */
  burstFrameCount: 15,
  burstDurationMs: 5000,
  keepBestCount: 3,
} as const;

/**
 * Calibration-card (ArUco) detection and light-direction estimation.
 * PLACEHOLDER values pending the real card's physical design/marker
 * layout, per "off the shelf now, replace if inadequate": these get the
 * mechanism working end to end, not tuned to a specific printed card.
 */
export const CARD_CONFIG = {
  dictionaryName: 'ARUCO_MIP_36h12',
  maxHammingDistance: 5,
  /** Marker IDs expected on the card. Placeholder: 4 corner markers. */
  expectedMarkerIds: [0, 1, 2, 3] as number[],
  /**
   * Normalized position (0-1, relative to the quad spanned by the 4
   * corner markers) of a small glossy/white reference patch used to
   * estimate light direction from its specular highlight. Placeholder
   * center position pending real card layout.
   */
  lightReferencePatch: { x: 0.5, y: 0.5, radiusFraction: 0.08 },
  /**
   * How square-on the marker quad's two diagonals must be to each
   * other (ratio of lengths, 1.0 = perfectly flat/frontal) to count as
   * "card held flat", per the spec's "guides the clinician to ensure
   * the patient holds it flat".
   */
  maxDiagonalRatioDeviation: 0.25,
} as const;

/**
 * v2: the viewfinder keeps capturing (instead of stopping after one
 * shot) so the user can vary their angle within the valid cone and
 * build up a set of shots to pick from. Capped per session so a single
 * sitting can't grow the on-device gallery unbounded.
 */
export const MAX_SESSION_CAPTURES = 8;

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
