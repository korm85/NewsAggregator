import { THRESHOLDS, type MaxGateConfig, type RangeGateConfig } from '../config';
import { resolveAngleDirection } from './directionPrompt';
import type {
  ArrowDirection,
  FrameInputs,
  GateEvaluation,
  GateId,
  GateState,
  PassingState,
} from './types';

const GATE_ORDER: GateId[] = [
  'face',
  'distance',
  'centering',
  'angle',
  'roll',
  'stability',
  'exposure',
];

function passMax(value: number, wasPassing: boolean, cfg: MaxGateConfig): boolean {
  return wasPassing ? value <= cfg.exitMax : value <= cfg.enterMax;
}

function passRange(value: number, wasPassing: boolean, cfg: RangeGateConfig): boolean {
  return wasPassing
    ? value >= cfg.exitMin && value <= cfg.exitMax
    : value >= cfg.enterMin && value <= cfg.enterMax;
}

/**
 * Pure function: Layer 2 of the architecture (handoff Section 4). No DOM
 * access, no side effects. Same inputs always produce the same outputs,
 * which is what makes the hysteresis boundaries in gateEvaluator.test.ts
 * meaningful. All tuning constants live in config.ts, not here.
 */
export function evaluateGates(input: FrameInputs, prevState: GateState): GateEvaluation {
  const { tracker, clippedFraction, nowMs } = input;
  const prevPassing = prevState.passing;
  const passing: PassingState = { ...prevPassing };

  const checksumHistory = [...prevState.checksumHistory, tracker.landmarkChecksum].slice(
    -THRESHOLDS.historyLength,
  );

  // Gate 1: face present. Boolean detection has no graded value to apply
  // hysteresis to, so this gate is a direct pass-through.
  passing.face = tracker.detected;

  if (!tracker.detected || !tracker.mouthBox) {
    passing.distance = false;
    passing.centering = false;
    passing.angle = false;
    passing.roll = false;
    passing.stability = false;
    passing.exposure = false;
  } else {
    const box = tracker.mouthBox;

    // Gate 2: distance. Box width is already a fraction of frame width
    // because landmarks are normalized 0-1.
    passing.distance = passRange(box.w, prevPassing.distance, THRESHOLDS.distance);

    // Gate 3: centering.
    const centerOffset = Math.hypot(box.x + box.w / 2 - 0.5, box.y + box.h / 2 - 0.5);
    passing.centering = passMax(centerOffset, prevPassing.centering, THRESHOLDS.centering);

    // Gate 4: angle.
    passing.angle = passMax(tracker.offAxisDeg, prevPassing.angle, THRESHOLDS.angle);

    // Gate 5: roll.
    passing.roll = passMax(Math.abs(tracker.rollDeg), prevPassing.roll, THRESHOLDS.roll);

    // Gate 6: stability, approximated from landmark checksum deltas.
    // See TrackerResult.landmarkChecksum for what the checksum encodes.
    passing.stability = evaluateStability(checksumHistory, prevPassing.stability);

    // Gate 7: exposure.
    passing.exposure = passMax(clippedFraction, prevPassing.exposure, THRESHOLDS.exposure);
  }

  const gateStatuses = passing;
  const allPassed = GATE_ORDER.every((g) => gateStatuses[g]);

  const failingGate = GATE_ORDER.find((g) => !gateStatuses[g]) ?? null;
  const candidate = buildPrompt(failingGate, tracker.offAxisVec, tracker.mouthBox);
  const promptChanged = candidate.text !== prevState.currentPrompt;

  const isLocked =
    prevState.promptSince !== -Infinity &&
    nowMs - prevState.promptSince < THRESHOLDS.minPromptDisplayMs;

  let currentPrompt: string | null;
  let arrowDirection: ArrowDirection;
  let promptSince: number;

  if (promptChanged && isLocked) {
    // Handoff Section 7: a prompt must stay up at least 800ms before it
    // can be replaced, even if the failing gate changes underneath it.
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

  const history = [...prevState.history, tracker].slice(-THRESHOLDS.historyLength);

  const newState: GateState = {
    passing,
    history,
    checksumHistory,
    currentPrompt,
    currentArrowDirection: arrowDirection,
    promptSince,
    holdCount,
  };

  return {
    gateStatuses,
    allPassed,
    captureTriggered,
    holdCount,
    holdRequired: THRESHOLDS.holdFramesRequired,
    prompt: currentPrompt,
    arrowDirection,
    boxColor: !tracker.detected ? 'none' : allPassed ? 'green' : 'amber',
    state: newState,
  };
}

function evaluateStability(checksumHistory: number[], wasPassing: boolean): boolean {
  if (checksumHistory.length < 2) return false;
  let totalDelta = 0;
  for (let i = 1; i < checksumHistory.length; i++) {
    totalDelta += Math.abs(checksumHistory[i] - checksumHistory[i - 1]);
  }
  const meanDelta = totalDelta / (checksumHistory.length - 1);
  // checksum sums x_px + y_px over 20 outer-lip points, so ~40 scalar
  // components contribute per frame; divide down to approximate a
  // mean per-landmark pixel movement.
  const approxPxMovement = meanDelta / 40;
  return passMax(approxPxMovement, wasPassing, THRESHOLDS.stability);
}

function buildPrompt(
  failingGate: GateId | null,
  offAxisVec: { x: number; y: number },
  mouthBox: { x: number; y: number; w: number; h: number } | null,
): { text: string | null; direction: ArrowDirection } {
  if (!failingGate) return { text: null, direction: null };

  switch (failingGate) {
    case 'face':
      return { text: 'Bring your smile into view', direction: null };
    case 'distance': {
      const tooClose = mouthBox ? mouthBox.w > THRESHOLDS.distance.enterMax : false;
      return tooClose
        ? { text: 'Move back', direction: null }
        : { text: 'Move closer', direction: null };
    }
    case 'centering':
      return { text: 'Center your smile in the frame', direction: null };
    case 'angle': {
      const { direction, text } = resolveAngleDirection(offAxisVec);
      return { text, direction };
    }
    case 'roll':
      return { text: 'Keep the phone level', direction: null };
    case 'stability':
      return { text: 'Hold still', direction: null };
    case 'exposure':
      return { text: 'Reduce the light', direction: null };
  }
}
