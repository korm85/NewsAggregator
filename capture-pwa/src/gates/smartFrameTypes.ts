import type { CardDetectionResult } from '../capture/cardDetector';
import type { TrackerResult } from '../tracker/types';
import type { ArrowDirection } from './types';

/**
 * Smart Frame spec gates. Distinct from the older 7-gate set in
 * gates/types.ts (distance/centering/stability/exposure), which this
 * feature does not use: the spec only calls for pose (split into pitch
 * and yaw, not a combined cone), smile width, and, when the calibration
 * card toggle is on, card presence/flatness. 'card' is only ever
 * evaluated when cardboardMode is true; see activeGateIds(). 'smile' is
 * a single gate backed by two metrics (mar as a mouth-not-closed floor,
 * smileWidthRatio as the actual width signal), see smartFrameEvaluator.ts.
 */
export type SmartFrameGateId = 'face' | 'pitch' | 'yaw' | 'smile' | 'card';

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
}

export function createInitialSmartFrameState(): SmartFrameGateState {
  return {
    passing: {
      face: false,
      pitch: false,
      yaw: false,
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
  return cardboardMode ? ['face', 'pitch', 'yaw', 'smile', 'card'] : ['face', 'pitch', 'yaw', 'smile'];
}
