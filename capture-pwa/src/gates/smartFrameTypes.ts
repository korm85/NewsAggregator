import type { CardDetectionResult } from '../capture/cardDetector';
import type { TrackerResult } from '../tracker/types';

/**
 * Owned here now that the legacy gates/types.ts (7-gate system) is gone
 * -- this is the only gate system left, so there's no longer a reason
 * for ArrowDirection to live in a separate shared file.
 */
export type ArrowDirection = 'left' | 'right' | 'up' | 'down' | null;

/**
 * Smart Frame spec gates, extended for video-first "Active Sweep"
 * capture: 'roll' and 'distance' lock the starting geometry strictly
 * (both always active, not cardboard-specific) before the sweep begins,
 * on top of the original pose/smile/card set. 'card' is only ever
 * evaluated when cardboardMode is true; see activeGateIds(). 'smile' is
 * a single gate backed by two metrics (mar as a mouth-not-closed floor,
 * smileWidthRatio as the actual width signal), see smartFrameEvaluator.ts.
 */
export type SmartFrameGateId = 'face' | 'pitch' | 'yaw' | 'roll' | 'distance' | 'smile' | 'card';

export type SmartFramePassingState = Record<SmartFrameGateId, boolean>;

export interface SmartFrameGateState {
  passing: SmartFramePassingState;
  currentPrompt: string | null;
  currentArrowDirection: ArrowDirection;
  promptSince: number;
  holdCount: number;
}

export interface SmartFrameEvaluation {
  gateStatuses: SmartFramePassingState;
  /** Only the gates active for this frame (see activeGateIds) count toward allPassed. */
  allPassed: boolean;
  /**
   * True exactly once: the frame `holdCount` first reaches
   * `holdFramesRequired`. Despite the name, this no longer fires
   * capture directly -- it's the one-shot signal that arms the
   * self-timer-style get-ready countdown in captureArmEvaluator.ts,
   * which decides if/when a capture should actually start (see its
   * `fireNow`). Consumers that used to treat this as "fire now" should
   * route through that module instead.
   */
  captureTriggered: boolean;
  holdCount: number;
  holdRequired: number;
  prompt: string | null;
  arrowDirection: ArrowDirection;
  frameColor: 'green' | 'amber' | 'none';
  state: SmartFrameGateState;
}

export interface SmartFrameInputs {
  tracker: TrackerResult;
  /**
   * Card detection for this frame. Only read when cardboardMode is
   * true; pass null on frames where card detection wasn't run (e.g.
   * throttled to every Nth frame for performance) to carry forward the
   * previous card gate state instead of failing it.
   */
  card: CardDetectionResult | null;
  cardboardMode: boolean;
  nowMs: number;
  /**
   * Runtime-adjustable target range for the distance gate (mouth-box
   * width as a fraction of frame width), sourced from the viewfinder's
   * debug panel in main.ts. Optional so every existing/older caller
   * (unit tests included) keeps compiling and behaving sanely: falls
   * back to config.ts's DISTANCE_GATE_DEFAULTS when omitted.
   */
  distanceRange?: { min: number; max: number };
}

export function createInitialSmartFrameState(): SmartFrameGateState {
  return {
    passing: {
      face: false,
      pitch: false,
      yaw: false,
      roll: false,
      distance: false,
      smile: false,
      card: false,
    },
    currentPrompt: null,
    currentArrowDirection: null,
    promptSince: -Infinity,
    holdCount: 0,
  };
}

/** Which gates count toward allPassed/capture this frame. */
export function activeGateIds(cardboardMode: boolean): SmartFrameGateId[] {
  const base: SmartFrameGateId[] = ['face', 'pitch', 'yaw', 'roll', 'distance', 'smile'];
  return cardboardMode ? [...base, 'card'] : base;
}
