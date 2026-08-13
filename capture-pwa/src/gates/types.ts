import type { TrackerResult } from '../tracker/types';

export type GateId =
  | 'face'
  | 'distance'
  | 'centering'
  | 'angle'
  | 'roll'
  | 'stability'
  | 'exposure';

export type ArrowDirection = 'left' | 'right' | 'up' | 'down' | null;

/** Per-gate hysteresis state, carried frame to frame. */
export type PassingState = Record<GateId, boolean>;

export interface GateState {
  passing: PassingState;
  history: TrackerResult[];
  checksumHistory: number[];
  currentPrompt: string | null;
  currentArrowDirection: ArrowDirection;
  promptSince: number;
  holdCount: number;
}

export interface GateEvaluation {
  gateStatuses: PassingState;
  allPassed: boolean;
  /** True once allPassed has held for the configured number of frames. */
  captureTriggered: boolean;
  holdCount: number;
  holdRequired: number;
  prompt: string | null;
  arrowDirection: ArrowDirection;
  boxColor: 'green' | 'amber' | 'none';
  state: GateState;
}

/**
 * Extra per-frame signal that the gate evaluator needs but the tracker
 * does not produce (it requires reading pixel data from the video frame,
 * which is a DOM/canvas concern that belongs in the UI layer, not the
 * tracker). The UI layer samples the mouth box region each frame and
 * passes the clipped-pixel fraction in here. The evaluator itself stays
 * a pure function: given the same TrackerResult + exposure number +
 * history + state, it always returns the same evaluation.
 */
export interface FrameInputs {
  tracker: TrackerResult;
  /** Fraction (0-1) of mouth-box pixels with any channel above 250. */
  clippedFraction: number;
  nowMs: number;
}

export function createInitialGateState(): GateState {
  return {
    passing: {
      face: false,
      distance: false,
      centering: false,
      angle: false,
      roll: false,
      stability: false,
      exposure: false,
    },
    history: [],
    checksumHistory: [],
    currentPrompt: null,
    currentArrowDirection: null,
    promptSince: -Infinity,
    holdCount: 0,
  };
}
