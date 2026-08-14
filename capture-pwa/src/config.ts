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

export interface MaxGateConfig {
  enterMax: number;
  exitMax: number;
}

/** Opposite of MaxGateConfig: must be AT LEAST this value to pass, exit band is lower than enter. */
export interface MinGateConfig {
  enterMin: number;
  exitMin: number;
}

/**
 * Distance gate defaults: mouth-box width as a fraction of frame width
 * (landmarks are normalized 0-1, so this needs no extra division). 0.15-
 * 0.25 approximates 15-25cm from camera to face, chosen to guarantee
 * sharp optical focus, but -- like the first two smileWidth guesses
 * before real on-device data corrected them -- this range is a starting
 * estimate, not yet calibrated against a real capture set. Runtime-
 * adjustable (see the viewfinder's debug panel, `onDistanceRangeChange`
 * in main.ts) specifically so it can be retuned on a real device without
 * a redeploy. `evaluateSmartFrame` falls back to this default whenever a
 * caller doesn't supply its own `distanceRange` (e.g. every existing
 * unit test).
 */
export const DISTANCE_GATE_DEFAULTS = { min: 0.15, max: 0.25 } as const;

/** Buffer added outside [min, max] before an already-passing distance gate exits, so the adjustable range doesn't need separate enter/exit sliders. */
export const DISTANCE_GATE_HYSTERESIS = 0.02;

export const THRESHOLDS = {
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
   * 0.784) as no more "smiling" than the rejected one.
   *
   * The first two placeholders (1.2/1.05, then 1.0/0.9) were both
   * guesses assuming a wide smile scores above 1.0 -- wrong. A real
   * on-device sample of a deliberately extreme smile (mouth wide open,
   * teeth fully bared top and bottom, burned-in overlay: pitchDeg
   * 10.58, yawDeg 0.44, rollDeg -2.80, mar 0.422) scored smileWidth
   * 0.71. Mouth width is naturally less than interocular distance for
   * most faces even smiling hard, so the whole prior magnitude
   * assumption was off, not just the exact number. 0.55 sits below
   * that real sample with headroom (that photo was an intentionally
   * maximal test case, not the bar every capture needs to clear), 0.45
   * is the usual hysteresis exit band beneath it. Anchored to one real
   * extreme-smile data point, not a calibration set across face
   * shapes, still expect to retune (smileWidthRatio is burned into
   * every saved image and shown live, see mediapipeTracker.ts).
   */
  smileWidth: {
    enterMin: 0.55,
    exitMin: 0.45,
  } satisfies MinGateConfig,

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
  /**
   * Three still candidates are grabbed in rapid succession right at the
   * trigger instant, not just one -- insurance against a single bad
   * frame (blink, motion blur, a stray highlight) with no fallback,
   * which was the accepted risk of the original single-anchor-frame
   * design. All three are kept (nothing is silently discarded) and each
   * is scored (sharpness/clipping, frameScore.ts) so the best one can be
   * flagged for callers that just want one, e.g. the gallery thumbnail.
   * 120ms between frames specifically covers a typical human blink
   * (100-400ms) without meaningfully delaying the exposure lock/settle
   * that follows -- still effectively "at the trigger instant" next to
   * the 5s sweep, and far faster than the 500ms `sensorSettleMs` delay
   * this whole capture used to (wrongly) pay before grabbing anything.
   */
  stillFrameCount: 3,
  stillFrameIntervalMs: 120,
  sensorSettleMs: 500,
  /**
   * The "Active Sweep" window: the three still candidates above are
   * grabbed before this window starts (before the user begins moving
   * the camera), then a supplementary video records for this window's
   * full duration while the user slowly sweeps the camera side-to-side.
   * The video, not the stills, is the primary color-calibration
   * artifact -- the offline post-processor extracts angular telemetry
   * and removes glare from the multiple reflection angles the sweep
   * captures, more accurately than the live browser tracker could.
   */
  burstDurationMs: 5000,
} as const;

/**
 * Target bitrate for the supplementary MediaRecorder video
 * (videoRecorder.ts). The video is now the primary color-calibration
 * artifact (see CAPTURE_SEQUENCE above), so its encode quality matters
 * more than before: a high target minimizes compression artifacts in
 * the specular-highlight detail the offline glare-removal step depends
 * on. Passed as `videoBitsPerSecond`, a hint the encoder clamps to
 * whatever it can actually sustain rather than erroring on, same
 * `ideal`-not-`exact` philosophy as the resolution constraints in
 * deviceCamera.ts -- asking high is safe, it can't fail a device that
 * tops out lower.
 */
export const TARGET_VIDEO_BITRATE_BPS = 16_000_000;

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
