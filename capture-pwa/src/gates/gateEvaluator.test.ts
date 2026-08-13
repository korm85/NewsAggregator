import { describe, expect, it } from 'vitest';
import { evaluateGates } from './gateEvaluator';
import { createInitialGateState, type GateState } from './types';
import type { TrackerResult } from '../tracker/types';

function makeTracker(overrides: Partial<TrackerResult> = {}): TrackerResult {
  return {
    detected: true,
    mouthBox: { x: 0.325, y: 0.425, w: 0.35, h: 0.15 }, // centered, width 0.35
    offAxisDeg: 0,
    offAxisVec: { x: 0, y: 0 },
    rollDeg: 0,
    landmarkChecksum: 1000,
    ...overrides,
  };
}

/** Runs N identical frames through the evaluator, advancing the clock 40ms per frame. */
function run(
  state: GateState,
  tracker: TrackerResult,
  frames: number,
  startMs: number,
  clippedFraction = 0,
) {
  let s = state;
  let evaluation;
  let now = startMs;
  for (let i = 0; i < frames; i++) {
    evaluation = evaluateGates({ tracker, clippedFraction, nowMs: now }, s);
    s = evaluation.state;
    now += 40;
  }
  return { evaluation: evaluation!, state: s, now };
}

describe('evaluateGates: angle hysteresis', () => {
  it('is green at 15 degrees off axis', () => {
    const seed = run(createInitialGateState(), makeTracker(), 6, 0).state;
    const { evaluation } = run(seed, makeTracker({ offAxisDeg: 15 }), 3, 1000);
    expect(evaluation.gateStatuses.angle).toBe(true);
  });

  it('is amber at 19 degrees off axis', () => {
    const seed = run(createInitialGateState(), makeTracker(), 6, 0).state;
    const { evaluation } = run(seed, makeTracker({ offAxisDeg: 19 }), 3, 1000);
    expect(evaluation.gateStatuses.angle).toBe(false);
  });

  it('does not flicker between 16 and 18 once already green (hysteresis band)', () => {
    let { state, now } = run(createInitialGateState(), makeTracker({ offAxisDeg: 10 }), 6, 0);
    // Enter green at 10deg, then drift to 16 (inside enter-fail / exit-pass band).
    let evaluation;
    ({ evaluation, state, now } = run(state, makeTracker({ offAxisDeg: 16 }), 1, now));
    expect(evaluation.gateStatuses.angle).toBe(true);
    ({ evaluation, state, now } = run(state, makeTracker({ offAxisDeg: 18 }), 1, now));
    expect(evaluation.gateStatuses.angle).toBe(true);
    ({ evaluation, state, now } = run(state, makeTracker({ offAxisDeg: 18.5 }), 1, now));
    expect(evaluation.gateStatuses.angle).toBe(false);
  });

  it('does not re-enter green until dropping back to 15 after failing', () => {
    let { state, now } = run(createInitialGateState(), makeTracker({ offAxisDeg: 20 }), 6, 0);
    let evaluation;
    ({ evaluation, state, now } = run(state, makeTracker({ offAxisDeg: 17 }), 1, now));
    expect(evaluation.gateStatuses.angle).toBe(false);
    ({ evaluation, state, now } = run(state, makeTracker({ offAxisDeg: 15 }), 1, now));
    expect(evaluation.gateStatuses.angle).toBe(true);
  });
});

describe('evaluateGates: prompt priority', () => {
  it('shows only the first failing gate prompt, even when multiple gates fail', () => {
    const tracker = makeTracker({
      detected: true,
      mouthBox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, // fails distance (too far) and centering
      offAxisDeg: 30, // also fails angle
    });
    const { evaluation } = run(createInitialGateState(), tracker, 1, 0);
    expect(evaluation.prompt).toBe('Move closer');
  });

  it('prompts to bring the smile into view when no face is detected', () => {
    const { evaluation } = run(createInitialGateState(), makeTracker({ detected: false, mouthBox: null }), 1, 0);
    expect(evaluation.prompt).toBe('Bring your smile into view');
  });
});

describe('evaluateGates: minimum prompt display duration', () => {
  it('keeps showing a prompt for at least 800ms even if the failing gate changes', () => {
    const state0 = createInitialGateState();
    const angleFail = makeTracker({ offAxisDeg: 30 });
    const first = evaluateGates({ tracker: angleFail, clippedFraction: 0, nowMs: 0 }, state0);
    expect(first.prompt).not.toBeNull();

    // Switch to a completely different failing gate 400ms later (< 800ms lock).
    const rollFail = makeTracker({ offAxisDeg: 0, rollDeg: 20 });
    const second = evaluateGates({ tracker: rollFail, clippedFraction: 0, nowMs: 400 }, first.state);
    expect(second.prompt).toBe(first.prompt);

    // 900ms after the original prompt appeared, it is allowed to change.
    const third = evaluateGates({ tracker: rollFail, clippedFraction: 0, nowMs: 900 }, second.state);
    expect(third.prompt).toBe('Keep the phone level');
  });
});

describe('evaluateGates: capture trigger', () => {
  it('triggers capture exactly once after 5 consecutive all-pass frames', () => {
    let state = createInitialGateState();
    const goodTracker = makeTracker();
    let triggeredCount = 0;
    let now = 0;
    for (let i = 0; i < 8; i++) {
      const evaluation = evaluateGates({ tracker: goodTracker, clippedFraction: 0, nowMs: now }, state);
      state = evaluation.state;
      if (evaluation.captureTriggered) triggeredCount++;
      now += 40;
    }
    expect(triggeredCount).toBe(1);
  });

  it('resets the hold count when any gate fails mid hold', () => {
    let state = createInitialGateState();
    const goodTracker = makeTracker();
    const badTracker = makeTracker({ offAxisDeg: 30 });
    let now = 0;
    for (let i = 0; i < 3; i++) {
      const evaluation = evaluateGates({ tracker: goodTracker, clippedFraction: 0, nowMs: now }, state);
      state = evaluation.state;
      now += 40;
    }
    const dropped = evaluateGates({ tracker: badTracker, clippedFraction: 0, nowMs: now }, state);
    expect(dropped.holdCount).toBe(0);
  });
});

describe('evaluateGates: roll hysteresis', () => {
  it('passes at 5 degrees, fails at 6 before entering, holds until 6 after entering', () => {
    const { evaluation: e1 } = run(createInitialGateState(), makeTracker({ rollDeg: 5 }), 1, 0);
    expect(e1.gateStatuses.roll).toBe(true);

    const { evaluation: e2 } = run(createInitialGateState(), makeTracker({ rollDeg: 5.5 }), 1, 0);
    expect(e2.gateStatuses.roll).toBe(false);

    let { state, now } = run(createInitialGateState(), makeTracker({ rollDeg: 2 }), 3, 0);
    const e3 = evaluateGates({ tracker: makeTracker({ rollDeg: 5.5 }), clippedFraction: 0, nowMs: now }, state);
    expect(e3.gateStatuses.roll).toBe(true);
  });
});

describe('evaluateGates: distance direction copy', () => {
  it('says move closer when the mouth box is too small', () => {
    const { evaluation } = run(
      createInitialGateState(),
      makeTracker({ mouthBox: { x: 0.4, y: 0.45, w: 0.2, h: 0.1 } }),
      1,
      0,
    );
    expect(evaluation.prompt).toBe('Move closer');
  });

  it('says move back when the mouth box is too large', () => {
    const { evaluation } = run(
      createInitialGateState(),
      makeTracker({ mouthBox: { x: 0.3, y: 0.4, w: 0.5, h: 0.2 } }),
      1,
      0,
    );
    expect(evaluation.prompt).toBe('Move back');
  });
});
