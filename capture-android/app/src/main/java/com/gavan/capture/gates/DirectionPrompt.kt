package com.gavan.capture.gates

import com.gavan.capture.config.MIRRORED
import com.gavan.capture.tracker.Vec2
import kotlin.math.abs

data class DirectionResolution(val direction: ArrowDirection, val text: String)

/**
 * Mirrors capture-pwa/src/gates/directionPrompt.ts. offAxisVec comes
 * straight from the transformation matrix in raw camera space, never
 * from mirrored display coordinates -- positive x is raw-frame-right,
 * which for a mirrored (front camera, selfie) display appears on the
 * screen's LEFT side, hence the XOR against MIRRORED below. Both the
 * text and arrow direction come out of this one function so they can
 * never disagree.
 */
fun resolveAngleDirection(offAxisVec: Vec2): DirectionResolution {
    val horizontalDominant = abs(offAxisVec.x) >= abs(offAxisVec.y)

    if (horizontalDominant) {
        val rawPointsRight = offAxisVec.x > 0
        val screenRight = if (MIRRORED) !rawPointsRight else rawPointsRight
        return if (screenRight) {
            DirectionResolution(ArrowDirection.RIGHT, "Move the phone to your right")
        } else {
            DirectionResolution(ArrowDirection.LEFT, "Move the phone to your left")
        }
    }

    val pointsUp = offAxisVec.y < 0
    return if (pointsUp) {
        DirectionResolution(ArrowDirection.UP, "Raise the phone")
    } else {
        DirectionResolution(ArrowDirection.DOWN, "Lower the phone")
    }
}
