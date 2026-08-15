import {
  createInitialCaptureArmState,
  type CaptureArmEvaluation,
  type CaptureArmInputs,
  type CaptureArmState,
} from './captureArmTypes';

/**
 * Pure function, same contract as evaluateSmartFrame: deterministic
 * given (input, prevState), no DOM/timer access. `holdReached` only
 * matters while idle (it's a one-shot edge from evaluateSmartFrame's
 * captureTriggered, which by construction can't re-fire mid-count
 * without holdCount resetting first); `allPassed` is read continuously
 * while counting, and any false cancels immediately.
 */
export function evaluateCaptureArm(
  input: CaptureArmInputs,
  prevState: CaptureArmState,
): CaptureArmEvaluation {
  const { holdReached, allPassed, nowMs, durationMs } = input;

  if (prevState.phase === 'idle') {
    if (!holdReached) {
      return {
        phase: 'idle',
        displayTick: null,
        tickJustChanged: false,
        fireNow: false,
        justCanceled: false,
        state: prevState,
      };
    }
    return evaluateCounting({ phase: 'counting', armedSince: nowMs, lastAnnouncedTick: -1 }, nowMs, durationMs);
  }

  if (!allPassed) {
    return {
      phase: 'idle',
      displayTick: null,
      tickJustChanged: false,
      fireNow: false,
      justCanceled: true,
      state: createInitialCaptureArmState(),
    };
  }
  return evaluateCounting(prevState, nowMs, durationMs);
}

function evaluateCounting(state: CaptureArmState, nowMs: number, durationMs: number): CaptureArmEvaluation {
  const elapsed = nowMs - state.armedSince;
  if (elapsed >= durationMs) {
    return {
      phase: 'idle',
      displayTick: null,
      tickJustChanged: false,
      fireNow: true,
      justCanceled: false,
      state: createInitialCaptureArmState(),
    };
  }

  const remainingMs = Math.max(0, durationMs - elapsed);
  const displayTick = Math.max(1, Math.ceil(remainingMs / 1000));
  const tickJustChanged = displayTick !== state.lastAnnouncedTick;
  const nextState: CaptureArmState = {
    phase: 'counting',
    armedSince: state.armedSince,
    lastAnnouncedTick: displayTick,
  };

  return {
    phase: 'counting',
    displayTick,
    tickJustChanged,
    fireNow: false,
    justCanceled: false,
    state: nextState,
  };
}
