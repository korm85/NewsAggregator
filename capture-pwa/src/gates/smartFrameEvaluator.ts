import { THRESHOLDS, type MaxGateConfig, type MinGateConfig } from '../config';
import { resolveAngleDirection } from './directionPrompt';
import {
  activeGateIds,
  type SmartFrameEvaluation,
  type SmartFrameGateId,
  type SmartFrameGateState,
  type SmartFrameInputs,
  type SmartFramePassingState,
} from './smartFrameTypes';
import type { ArrowDirection } from './types';

function passMax(value: number, wasPassing: boolean, cfg: MaxGateConfig): boolean {
  return wasPassing ? value <= cfg.exitMax : value <= cfg.enterMax;
}

function passMin(value: number, wasPassing: boolean, cfg: MinGateConfig): boolean {
  return wasPassing ? value >= cfg.exitMin : value >= cfg.enterMin;
}

/**
 * Pure function, same shape/contract as gates/gateEvaluator.ts (no DOM
 * access, deterministic given the same inputs + prevState). Kept as a
 * separate module rather than folded into the older evaluator because
 * the Smart Frame spec's gate set (pitch/yaw split, MAR, card) and its
 * "with/without cardboard" toggle don't map onto the older 7-gate
 * distance/centering/stability/exposure design, and main.ts no longer
 * drives that older evaluator.
 */
export function evaluateSmartFrame(
  input: SmartFrameInputs,
  prevState: SmartFrameGateState,
): SmartFrameEvaluation {
  const { tracker, card, cardboardMode, nowMs } = input;
  const prevPassing = prevState.passing;
  const passing: SmartFramePassingState = { ...prevPassing };

  passing.face = tracker.detected;

  if (!tracker.detected) {
    passing.pitch = false;
    passing.yaw = false;
    passing.mar = false;
  } else {
    passing.pitch = passMax(Math.abs(tracker.pitchDeg), prevPassing.pitch, THRESHOLDS.pitch);
    passing.yaw = passMax(Math.abs(tracker.yawDeg), prevPassing.yaw, THRESHOLDS.yaw);
    passing.mar = passMin(tracker.mar, prevPassing.mar, THRESHOLDS.smileMar);
  }

  // Card presence/flatness is a direct read of this frame's detection,
  // no hysteresis: unlike the continuous pose/smile metrics, there's no
  // meaningful "recently was flat" state to smooth over, and a stale
  // card gate would let the clinician walk away from the card thinking
  // it's still being validated. A null `card` (detection throttled this
  // frame) carries the previous verdict forward instead of failing it.
  if (cardboardMode) {
    passing.card = card ? card.allMarkersVisible && card.isFlat : prevPassing.card;
  } else {
    passing.card = true;
  }

  const gateOrder = activeGateIds(cardboardMode);
  const allPassed = gateOrder.every((g) => passing[g]);
  const failingGate = gateOrder.find((g) => !passing[g]) ?? null;

  const candidate = buildPrompt(failingGate, tracker.offAxisVec, card);
  const promptChanged = candidate.text !== prevState.currentPrompt;

  const isLocked =
    prevState.promptSince !== -Infinity &&
    nowMs - prevState.promptSince < THRESHOLDS.minPromptDisplayMs;

  let currentPrompt: string | null;
  let arrowDirection: ArrowDirection;
  let promptSince: number;

  if (promptChanged && isLocked) {
    currentPrompt = prevState.currentPrompt;
    arrowDirection = prevState.currentArrowDirection;
    promptSince = prevState.promptSince;
  } else if (promptChanged) {
    currentPrompt = candidate.text;
    arrowDirection = candidate.direction;
    promptSince = nowMs;
  } else {
    currentPrompt = prevState.currentPrompt;
    arrowDirection = prevState.currentArrowDirection;
    promptSince = prevState.promptSince === -Infinity ? nowMs : prevState.promptSince;
  }

  const holdCount = allPassed ? prevState.holdCount + 1 : 0;
  const captureTriggered = holdCount === THRESHOLDS.holdFramesRequired;

  const newState: SmartFrameGateState = {
    passing,
    currentPrompt,
    currentArrowDirection: arrowDirection,
    promptSince,
    holdCount,
  };

  return {
    gateStatuses: passing,
    allPassed,
    captureTriggered,
    holdCount,
    holdRequired: THRESHOLDS.holdFramesRequired,
    prompt: currentPrompt,
    arrowDirection,
    frameColor: !tracker.detected ? 'none' : allPassed ? 'green' : 'amber',
    state: newState,
  };
}

function buildPrompt(
  failingGate: SmartFrameGateId | null,
  offAxisVec: { x: number; y: number },
  card: { allMarkersVisible: boolean; isFlat: boolean } | null,
): { text: string | null; direction: ArrowDirection } {
  if (!failingGate) return { text: null, direction: null };

  switch (failingGate) {
    case 'face':
      return { text: 'Bring your smile into view', direction: null };
    case 'pitch':
    case 'yaw': {
      const { direction, text } = resolveAngleDirection(offAxisVec);
      return { text, direction };
    }
    case 'mar':
      return { text: 'Ask the patient to smile wide', direction: null };
    case 'card': {
      const text =
        card && !card.allMarkersVisible
          ? 'Make sure all markers on the card are visible'
          : 'Hold the card flat and unobstructed';
      return { text, direction: null };
    }
  }
}
