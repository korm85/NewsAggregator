import { describe, expect, it } from 'vitest';
import type { CardDetectionResult } from '../capture/cardDetector';
import type { TrackerResult } from '../tracker/types';
import { evaluateSmartFrame } from './smartFrameEvaluator';
import { createInitialSmartFrameState, type SmartFrameGateState } from './smartFrameTypes';

function makeTracker(overrides: Partial<TrackerResult> = {}): TrackerResult {
  return {
    detected: true,
    mouthBox: { x: 0.325, y: 0.425, w: 0.35, h: 0.15 },
    offAxisDeg: 0,
    offAxisVec: { x: 0, y: 0 },
    rollDeg: 0,
    yawDeg: 0,
    pitchDeg: 0,
    mar: 0.4, // smiling wide by default
    landmarkChecksum: 1000,
    lipPoints: null,
    ...overrides,
  };
}

function makeCard(overrides: Partial<CardDetectionResult> = {}): CardDetectionResult {
  return {
    markersDetected: [0, 1, 2, 3],
    allMarkersVisible: true,
    cornerPoints: [],
    diagonalRatioDeviation: 0,
    isFlat: true,
    ...overrides,
  };
}

function run(
  state: SmartFrameGateState,
  tracker: TrackerResult,
  frames: number,
  startMs: number,
  card: CardDetectionResult | null = null,
  cardboardMode = false,
) {
  let s = state;
  let evaluation;
  let now = startMs;
  for (let i = 0; i < frames; i++) {
    evaluation = evaluateSmartFrame({ tracker, card, cardboardMode, nowMs: now }, s);
    s = evaluation.state;
    now += 40;
  }
  return { evaluation: evaluation!, state: s, now };
}

describe('evaluateSmartFrame: pitch/yaw hysteresis', () => {
  it('passes at 15 degrees, fails at 19, both pitch and yaw independently', () => {
    const { evaluation: pitchOk } = run(createInitialSmartFrameState(), makeTracker({ pitchDeg: 15 }), 1, 0);
    expect(pitchOk.gateStatuses.pitch).toBe(true);

    const { evaluation: pitchBad } = run(createInitialSmartFrameState(), makeTracker({ pitchDeg: 19 }), 1, 0);
    expect(pitchBad.gateStatuses.pitch).toBe(false);

    const { evaluation: yawOk } = run(createInitialSmartFrameState(), makeTracker({ yawDeg: -15 }), 1, 0);
    expect(yawOk.gateStatuses.yaw).toBe(true);

    const { evaluation: yawBad } = run(createInitialSmartFrameState(), makeTracker({ yawDeg: -19 }), 1, 0);
    expect(yawBad.gateStatuses.yaw).toBe(false);
  });

  it('does not flicker once green (hysteresis band)', () => {
    let { state, now } = run(createInitialSmartFrameState(), makeTracker({ pitchDeg: 5 }), 1, 0);
    let evaluation;
    ({ evaluation, state, now } = run(state, makeTracker({ pitchDeg: 17 }), 1, now));
    expect(evaluation.gateStatuses.pitch).toBe(true);
    ({ evaluation, state, now } = run(state, makeTracker({ pitchDeg: 18.5 }), 1, now));
    expect(evaluation.gateStatuses.pitch).toBe(false);
  });
});

describe('evaluateSmartFrame: MAR (smile width) gate', () => {
  it('fails a closed/half smile and prompts to smile wide', () => {
    const { evaluation } = run(createInitialSmartFrameState(), makeTracker({ mar: 0.1 }), 1, 0);
    expect(evaluation.gateStatuses.mar).toBe(false);
    expect(evaluation.prompt).toBe('Ask the patient to smile wide');
  });

  it('passes a wide smile', () => {
    const { evaluation } = run(createInitialSmartFrameState(), makeTracker({ mar: 0.4 }), 1, 0);
    expect(evaluation.gateStatuses.mar).toBe(true);
  });

  it('holds the pass through the exit band once entered (hysteresis)', () => {
    let { state, now } = run(createInitialSmartFrameState(), makeTracker({ mar: 0.4 }), 1, 0);
    const { evaluation } = run(state, makeTracker({ mar: 0.3 }), 1, now);
    expect(evaluation.gateStatuses.mar).toBe(true);
  });
});

describe('evaluateSmartFrame: cardboard toggle', () => {
  it('ignores the card gate entirely when cardboardMode is off', () => {
    const { evaluation } = run(createInitialSmartFrameState(), makeTracker(), 1, 0, null, false);
    expect(evaluation.allPassed).toBe(true);
  });

  it('requires all markers visible and flat when cardboardMode is on', () => {
    const { evaluation: missing } = run(
      createInitialSmartFrameState(),
      makeTracker(),
      1,
      0,
      makeCard({ allMarkersVisible: false }),
      true,
    );
    expect(missing.gateStatuses.card).toBe(false);
    expect(missing.allPassed).toBe(false);

    const { evaluation: tilted } = run(
      createInitialSmartFrameState(),
      makeTracker(),
      1,
      0,
      makeCard({ isFlat: false }),
      true,
    );
    expect(tilted.gateStatuses.card).toBe(false);
    expect(tilted.prompt).toBe('Hold the card flat and unobstructed');

    const { evaluation: good } = run(createInitialSmartFrameState(), makeTracker(), 1, 0, makeCard(), true);
    expect(good.gateStatuses.card).toBe(true);
    expect(good.allPassed).toBe(true);
  });

  it('carries the previous card verdict forward when detection is throttled (card = null)', () => {
    let { state, now } = run(createInitialSmartFrameState(), makeTracker(), 1, 0, makeCard(), true);
    const { evaluation } = run(state, makeTracker(), 1, now, null, true);
    expect(evaluation.gateStatuses.card).toBe(true);
  });
});

describe('evaluateSmartFrame: capture trigger', () => {
  it('triggers capture exactly once after holdFramesRequired consecutive all-pass frames', () => {
    let state = createInitialSmartFrameState();
    const goodTracker = makeTracker();
    let triggeredCount = 0;
    let now = 0;
    for (let i = 0; i < 8; i++) {
      const evaluation = evaluateSmartFrame(
        { tracker: goodTracker, card: null, cardboardMode: false, nowMs: now },
        state,
      );
      state = evaluation.state;
      if (evaluation.captureTriggered) triggeredCount++;
      now += 40;
    }
    expect(triggeredCount).toBe(1);
  });

  it('resets the hold count when any gate fails mid hold', () => {
    let state = createInitialSmartFrameState();
    const goodTracker = makeTracker();
    const badTracker = makeTracker({ pitchDeg: 30 });
    let now = 0;
    for (let i = 0; i < 3; i++) {
      const evaluation = evaluateSmartFrame(
        { tracker: goodTracker, card: null, cardboardMode: false, nowMs: now },
        state,
      );
      state = evaluation.state;
      now += 40;
    }
    const dropped = evaluateSmartFrame(
      { tracker: badTracker, card: null, cardboardMode: false, nowMs: now },
      state,
    );
    expect(dropped.holdCount).toBe(0);
  });
});

describe('evaluateSmartFrame: prompt priority and minimum display duration', () => {
  it('prompts to bring the smile into view when no face is detected', () => {
    const { evaluation } = run(createInitialSmartFrameState(), makeTracker({ detected: false }), 1, 0);
    expect(evaluation.prompt).toBe('Bring your smile into view');
  });

  it('keeps showing a prompt for at least 800ms even if the failing gate changes', () => {
    const state0 = createInitialSmartFrameState();
    const pitchFail = makeTracker({ pitchDeg: 30 });
    const first = evaluateSmartFrame({ tracker: pitchFail, card: null, cardboardMode: false, nowMs: 0 }, state0);
    expect(first.prompt).not.toBeNull();

    const marFail = makeTracker({ pitchDeg: 0, mar: 0.1 });
    const second = evaluateSmartFrame(
      { tracker: marFail, card: null, cardboardMode: false, nowMs: 400 },
      first.state,
    );
    expect(second.prompt).toBe(first.prompt);

    const third = evaluateSmartFrame(
      { tracker: marFail, card: null, cardboardMode: false, nowMs: 900 },
      second.state,
    );
    expect(third.prompt).toBe('Ask the patient to smile wide');
  });
});
