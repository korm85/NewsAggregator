/**
 * The "get ready" countdown that sits between a Smart Frame gate hold
 * completing (see smartFrameEvaluator.ts's captureTriggered) and
 * capture actually firing -- self-timer/photo-booth style, not an
 * instant fire. Deliberately a separate pure module rather than logic
 * inside evaluateSmartFrame: this is genuinely new state ("are we
 * mid-countdown, and for how long"), not pose/smile gate evaluation,
 * and evaluateSmartFrame should stay timing-agnostic.
 */
export type CaptureArmPhase = 'idle' | 'counting';

export interface CaptureArmState {
  phase: CaptureArmPhase;
  /** performance.now() when counting started; -Infinity when idle. */
  armedSince: number;
  /** Whole seconds remaining last reported via tickJustChanged; -1 when idle. */
  lastAnnouncedTick: number;
}

export interface CaptureArmInputs {
  /** One-shot "just reached holdFramesRequired" edge from evaluateSmartFrame's captureTriggered. Ignored once already counting. */
  holdReached: boolean;
  /** Continuous "are all active gates passing this frame" signal. Any false while counting cancels immediately. */
  allPassed: boolean;
  nowMs: number;
  /** Runtime-adjustable countdown length (see CAPTURE_ARM_DEFAULTS, config.ts); read fresh each call so a live Debug-panel change takes effect on the next frame without restarting the countdown. */
  durationMs: number;
}

export interface CaptureArmEvaluation {
  phase: CaptureArmPhase;
  /** Whole seconds remaining, e.g. 3, 2, 1; null when idle. */
  displayTick: number | null;
  /** True exactly once per second boundary, including the first tick -- the cue for a haptic pulse + tone. */
  tickJustChanged: boolean;
  /** True exactly once: the frame capture should actually start. */
  fireNow: boolean;
  /** True exactly once: a mid-count gate failure reset this to idle. */
  justCanceled: boolean;
  state: CaptureArmState;
}

export function createInitialCaptureArmState(): CaptureArmState {
  return { phase: 'idle', armedSince: -Infinity, lastAnnouncedTick: -1 };
}
