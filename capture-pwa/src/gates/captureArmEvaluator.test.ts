import { describe, expect, it } from 'vitest';
import { evaluateCaptureArm } from './captureArmEvaluator';
import { createInitialCaptureArmState, type CaptureArmState } from './captureArmTypes';

const DURATION_MS = 3000;

function step(
  state: CaptureArmState,
  nowMs: number,
  overrides: Partial<{ holdReached: boolean; allPassed: boolean; durationMs: number }> = {},
) {
  return evaluateCaptureArm(
    {
      holdReached: false,
      allPassed: true,
      nowMs,
      durationMs: DURATION_MS,
      ...overrides,
    },
    state,
  );
}

describe('evaluateCaptureArm: idle behavior', () => {
  it('stays idle and does nothing when holdReached is false', () => {
    const evaluation = step(createInitialCaptureArmState(), 0, { holdReached: false, allPassed: false });
    expect(evaluation.phase).toBe('idle');
    expect(evaluation.displayTick).toBeNull();
    expect(evaluation.tickJustChanged).toBe(false);
    expect(evaluation.fireNow).toBe(false);
    expect(evaluation.justCanceled).toBe(false);
  });

  it('starts counting exactly on the holdReached true-edge', () => {
    const evaluation = step(createInitialCaptureArmState(), 1000, { holdReached: true });
    expect(evaluation.phase).toBe('counting');
    expect(evaluation.displayTick).toBe(3);
    expect(evaluation.tickJustChanged).toBe(true);
  });
});

describe('evaluateCaptureArm: tick sequence', () => {
  it('counts down 3 -> 2 -> 1 at the right millisecond boundaries', () => {
    let state = createInitialCaptureArmState();
    let evaluation = step(state, 0, { holdReached: true });
    expect(evaluation.displayTick).toBe(3);
    state = evaluation.state;

    evaluation = step(state, 500);
    expect(evaluation.displayTick).toBe(3);
    expect(evaluation.tickJustChanged).toBe(false);
    state = evaluation.state;

    evaluation = step(state, 1000);
    expect(evaluation.displayTick).toBe(2);
    expect(evaluation.tickJustChanged).toBe(true);
    state = evaluation.state;

    evaluation = step(state, 1999);
    expect(evaluation.displayTick).toBe(2);
    state = evaluation.state;

    evaluation = step(state, 2000);
    expect(evaluation.displayTick).toBe(1);
    expect(evaluation.tickJustChanged).toBe(true);
    state = evaluation.state;

    evaluation = step(state, 2999);
    expect(evaluation.displayTick).toBe(1);
    expect(evaluation.phase).toBe('counting');
    expect(evaluation.fireNow).toBe(false);
  });

  it('does not re-announce the same tick every frame', () => {
    let state = createInitialCaptureArmState();
    let evaluation = step(state, 0, { holdReached: true });
    state = evaluation.state;
    evaluation = step(state, 100);
    expect(evaluation.tickJustChanged).toBe(false);
    evaluation = step(evaluation.state, 200);
    expect(evaluation.tickJustChanged).toBe(false);
  });
});

describe('evaluateCaptureArm: fire', () => {
  it('fires exactly once, only after the full duration with allPassed held throughout', () => {
    let state = createInitialCaptureArmState();
    let fireCount = 0;
    let evaluation = step(state, 0, { holdReached: true });
    state = evaluation.state;
    if (evaluation.fireNow) fireCount++;

    for (let t = 100; t <= DURATION_MS + 100; t += 100) {
      evaluation = step(state, t);
      if (evaluation.fireNow) fireCount++;
      state = evaluation.state;
    }

    expect(fireCount).toBe(1);
  });

  it('is idle again immediately after firing (self-resetting)', () => {
    let state = createInitialCaptureArmState();
    let evaluation = step(state, 0, { holdReached: true });
    state = evaluation.state;
    evaluation = step(state, DURATION_MS);
    expect(evaluation.fireNow).toBe(true);
    expect(evaluation.phase).toBe('idle');
    expect(evaluation.state.phase).toBe('idle');
  });
});

describe('evaluateCaptureArm: cancel on gate failure', () => {
  it('cancels immediately (no fireNow ever) if allPassed drops mid-count', () => {
    let state = createInitialCaptureArmState();
    let evaluation = step(state, 0, { holdReached: true });
    state = evaluation.state;
    evaluation = step(state, 1500);
    state = evaluation.state;

    evaluation = step(state, 1600, { allPassed: false });
    expect(evaluation.phase).toBe('idle');
    expect(evaluation.justCanceled).toBe(true);
    expect(evaluation.fireNow).toBe(false);
    state = evaluation.state;

    // Even if allPassed comes back without a fresh holdReached edge, it stays idle.
    evaluation = step(state, 1700, { allPassed: true, holdReached: false });
    expect(evaluation.phase).toBe('idle');
  });

  it('cancels even one frame before the duration would have completed', () => {
    let state = createInitialCaptureArmState();
    let evaluation = step(state, 0, { holdReached: true });
    state = evaluation.state;
    evaluation = step(state, DURATION_MS - 1, { allPassed: false });
    expect(evaluation.fireNow).toBe(false);
    expect(evaluation.justCanceled).toBe(true);
  });

  it('restarts the full countdown from the top on a fresh holdReached edge after a cancel', () => {
    let state = createInitialCaptureArmState();
    let evaluation = step(state, 0, { holdReached: true });
    state = evaluation.state;
    evaluation = step(state, 2000);
    state = evaluation.state;
    expect(evaluation.displayTick).toBe(1);

    evaluation = step(state, 2100, { allPassed: false });
    state = evaluation.state;
    expect(state.phase).toBe('idle');

    evaluation = step(state, 5000, { holdReached: true });
    expect(evaluation.phase).toBe('counting');
    expect(evaluation.displayTick).toBe(3);
  });
});

describe('evaluateCaptureArm: live duration changes', () => {
  it('re-derives displayTick sanely if durationMs changes mid-countdown', () => {
    let state = createInitialCaptureArmState();
    let evaluation = step(state, 0, { holdReached: true, durationMs: 3000 });
    state = evaluation.state;

    // Debug-panel slider dragged down mid-countdown.
    evaluation = step(state, 500, { durationMs: 1000 });
    expect(evaluation.phase).toBe('counting');
    expect(() => evaluation.displayTick).not.toThrow();
    state = evaluation.state;

    evaluation = step(state, 1000, { durationMs: 1000 });
    expect(evaluation.fireNow).toBe(true);
  });
});
