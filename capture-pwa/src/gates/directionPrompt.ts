import { MIRRORED } from '../config';
import type { ArrowDirection } from './types';

/**
 * Handoff Section 8: "the camera must move toward the direction the
 * face is pointing. If the face normal has a positive horizontal
 * component, the camera moves that way."
 *
 * offAxisVec comes straight from the transformation matrix in raw
 * camera space (see tracker/mediapipeTracker.ts), never from mirrored
 * display coordinates. Positive x is treated as raw-frame-right, which
 * for an unmirrored (rear camera) display is literally screen-right.
 * For a mirrored (front camera, selfie) display the image is flipped
 * horizontally, so raw-frame-right appears on the screen's LEFT side,
 * hence the XOR against MIRRORED below. This is the single point where
 * mirroring affects direction logic, exactly as the handoff requires
 * ("must be derived from the same config constant, never hardcoded
 * separately"), and both the text and the arrow direction come out of
 * this one function so they can never disagree.
 *
 * Verified on a real device: the arrow pointed the wrong way
 * horizontally until X_SIGN was flipped in mediapipeTracker.ts (see
 * that file's comment), correcting offAxisVec.x at the source so this
 * function's logic didn't need to change. Vertical (up/down) was
 * confirmed correct as-is.
 */
export function resolveAngleDirection(offAxisVec: { x: number; y: number }): {
  direction: ArrowDirection;
  text: string;
} {
  const horizontalDominant = Math.abs(offAxisVec.x) >= Math.abs(offAxisVec.y);

  if (horizontalDominant) {
    const rawPointsRight = offAxisVec.x > 0;
    const screenRight = MIRRORED ? !rawPointsRight : rawPointsRight;
    return screenRight
      ? { direction: 'right', text: 'Move the phone to your right' }
      : { direction: 'left', text: 'Move the phone to your left' };
  }

  const pointsUp = offAxisVec.y < 0;
  return pointsUp
    ? { direction: 'up', text: 'Raise the phone' }
    : { direction: 'down', text: 'Lower the phone' };
}
