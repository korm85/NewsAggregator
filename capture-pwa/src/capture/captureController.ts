import { CAPTURE_MODE, CAPTURE_SEQUENCE } from '../config';
import type { GateEvaluation } from '../gates/types';
import { runCaptureSequence, type CaptureResult, type TrackerSnapshot } from './captureSequence';

export type ControllerPhase = 'idle' | 'ring' | 'processing';

/**
 * Drives handoff Section 9 step 1: "Show a ring that fills over 400ms.
 * If any gate drops during the fill, abort and return to guidance."
 * Once the ring completes, the rest of the capture sequence
 * (lock/settle/burst/score) is not abortable, matching the spec (only
 * the fill itself is guarded).
 */
export class CaptureController {
  phase: ControllerPhase = 'idle';
  ringProgress = 0;

  private ringStartMs = 0;
  private lastSnapshot: TrackerSnapshot | null = null;

  constructor(private readonly onComplete: (result: CaptureResult) => void) {}

  handleFrame(
    now: number,
    evaluation: GateEvaluation,
    snapshot: TrackerSnapshot,
    video: HTMLVideoElement,
    track: MediaStreamTrack,
  ): void {
    if (this.phase === 'processing') return;

    if (this.phase === 'idle') {
      this.lastSnapshot = snapshot;
      if (evaluation.captureTriggered) {
        this.phase = 'ring';
        this.ringStartMs = now;
        this.ringProgress = 0;
      }
      return;
    }

    // phase === 'ring'
    if (!evaluation.allPassed) {
      this.phase = 'idle';
      this.ringProgress = 0;
      return;
    }

    this.lastSnapshot = snapshot;
    this.ringProgress = Math.min(1, (now - this.ringStartMs) / CAPTURE_SEQUENCE.ringFillMs);

    if (this.ringProgress >= 1) {
      this.phase = 'processing';
      const snapshotForCapture = this.lastSnapshot;
      // Not wired into main.ts (see README "The capture loop"), so
      // there's no live currentFacingMode to thread through here;
      // falls back to config's default.
      runCaptureSequence(video, track, snapshotForCapture, CAPTURE_MODE, {
        cardboardMode: false,
        card: null,
        light: null,
      }).then((result) => {
        this.phase = 'idle';
        this.ringProgress = 0;
        this.onComplete(result);
      });
    }
  }

  reset(): void {
    this.phase = 'idle';
    this.ringProgress = 0;
  }
}
