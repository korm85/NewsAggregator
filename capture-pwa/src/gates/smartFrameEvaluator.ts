import { DISTANCE_GATE_DEFAULTS, DISTANCE_GATE_HYSTERESIS, THRESHOLDS, type MaxGateConfig, type MinGateConfig } from '../config';
import { resolveAngleDirection } from './directionPrompt';
import {
  activeGateIds,
  type ArrowDirection,
  type SmartFrameEvaluation,
  type SmartFrameGateId,
  type SmartFrameGateState,
  type SmartFrameInputs,
  type SmartFramePassingState,
} from './smartFrameTypes';

function passMax(value: number, wasPassing: boolean, cfg: MaxGateConfig): boolean {
  return wasPassing ? value <= cfg.exitMax : value <= cfg.enterMax;
}

function passMin(value: number, wasPassing: boolean, cfg: MinGateConfig): boolean {
  return wasPassing ? value >= cfg.exitMin : value >= cfg.enterMin;
}

/**
 * The distance gate's [min, max] range is runtime-adjustable (see
 * SmartFrameInputs.distanceRange), so unlike the other gates it can't
 * carry separate enter/exit bands baked into config -- instead a fixed
 * buffer (DISTANCE_GATE_HYSTERESIS) is added outside whichever range is
 * active once passing, so the gate still doesn't flicker at the edges.
 */
function passDistance(value: number, wasPassing: boolean, range: { min: number; max: number }): boolean {
  const buffer = wasPassing ? DISTANCE_GATE_HYSTERESIS : 0;
  return value >= range.min - buffer && value <= range.max + buffer;
}

/**
 * Pure function: no DOM access, deterministic given the same inputs +
 * prevState. The only gate evaluator left in the codebase -- the
 * original 7-gate distance/centering/stability/exposure system this
 * once coexisted with has been deleted, not just superseded.
 */
export function evaluateSmartFrame(
  input: SmartFrameInputs,
  prevState: SmartFrameGateState,
): SmartFrameEvaluation {
  const { tracker, card, cardboardMode, nowMs } = input;
  const distanceRange = input.distanceRange ?? DISTANCE_GATE_DEFAULTS;
  const prevPassing = prevState.passing;
  const passing: SmartFramePassingState = { ...prevPassing };

  passing.face = tracker.detected;

  if (!tracker.detected) {
    passing.pitch = false;
    passing.yaw = false;
    passing.roll = false;
    passing.distance = false;
    passing.smile = false;
  } else {
    passing.pitch = passMax(Math.abs(tracker.pitchDeg), prevPassing.pitch, THRESHOLDS.pitch);
    passing.yaw = passMax(Math.abs(tracker.yawDeg), prevPassing.yaw, THRESHOLDS.yaw);
    passing.roll = passMax(Math.abs(tracker.rollDeg), prevPassing.roll, THRESHOLDS.roll);
    // Box width is already a fraction of frame width -- landmarks are
    // normalized 0-1 -- so no extra division is needed here.
    passing.distance = tracker.mouthBox
      ? passDistance(tracker.mouthBox.w, prevPassing.distance, distanceRange)
      : false;
    // Two metrics, one gate: MAR is just a mouth-not-closed floor,
    // smileWidthRatio is the actual "smiling wide" signal (see
    // TrackerResult and THRESHOLDS.smileWidth for why). Both need to
    // pass. prevPassing.smile is shared as the hysteresis reference for
    // both since they're only ever exposed as one combined gate.
    const marOk = passMin(tracker.mar, prevPassing.smile, THRESHOLDS.smileMar);
    const widthOk = passMin(tracker.smileWidthRatio, prevPassing.smile, THRESHOLDS.smileWidth);
    passing.smile = marOk && widthOk;
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

  const candidate = buildPrompt(failingGate, tracker.offAxisVec, card, tracker.mouthBox?.w ?? null, distanceRange);
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
  distanceRatio: number | null,
  distanceRange: { min: number; max: number },
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
    case 'roll':
      return { text: 'Straighten your head', direction: null };
    case 'distance': {
      const tooClose = distanceRatio !== null && distanceRatio > distanceRange.max;
      return tooClose
        ? { text: 'Move back', direction: null }
        : { text: 'Move closer', direction: null };
    }
    case 'smile':
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
