package com.gavan.capture.gates

import com.gavan.capture.config.DISTANCE_GATE_DEFAULTS
import com.gavan.capture.config.DistanceRange
import com.gavan.capture.tracker.TrackerResult

/** Mirrors capture-pwa/src/gates/smartFrameTypes.ts. */

enum class ArrowDirection { LEFT, RIGHT, UP, DOWN }

enum class SmartFrameGateId { FACE, PITCH, YAW, ROLL, DISTANCE, SMILE, CARD }

data class CardDetection(val allMarkersVisible: Boolean, val isFlat: Boolean, val markerIds: List<Int> = emptyList())

data class SmartFramePassingState(
    val face: Boolean = false,
    val pitch: Boolean = false,
    val yaw: Boolean = false,
    val roll: Boolean = false,
    val distance: Boolean = false,
    val smile: Boolean = false,
    val card: Boolean = false,
) {
    operator fun get(id: SmartFrameGateId): Boolean = when (id) {
        SmartFrameGateId.FACE -> face
        SmartFrameGateId.PITCH -> pitch
        SmartFrameGateId.YAW -> yaw
        SmartFrameGateId.ROLL -> roll
        SmartFrameGateId.DISTANCE -> distance
        SmartFrameGateId.SMILE -> smile
        SmartFrameGateId.CARD -> card
    }
}

data class SmartFrameGateState(
    val passing: SmartFramePassingState = SmartFramePassingState(),
    val currentPrompt: String? = null,
    val currentArrowDirection: ArrowDirection? = null,
    val promptSince: Double = Double.NEGATIVE_INFINITY,
    val holdCount: Int = 0,
)

enum class FrameColor { GREEN, AMBER, NONE }

data class SmartFrameEvaluation(
    val gateStatuses: SmartFramePassingState,
    /** Only the gates active for this frame (see activeGateIds) count toward allPassed. */
    val allPassed: Boolean,
    /**
     * True exactly once: the frame holdCount first reaches
     * holdFramesRequired. Doesn't fire capture directly -- it's the
     * one-shot signal that arms the get-ready countdown in
     * CaptureArmEvaluator, which decides if/when capture actually starts.
     */
    val captureTriggered: Boolean,
    val holdCount: Int,
    val holdRequired: Int,
    val prompt: String?,
    val arrowDirection: ArrowDirection?,
    val frameColor: FrameColor,
    val state: SmartFrameGateState,
)

data class SmartFrameInputs(
    val tracker: TrackerResult,
    /** Only read when cardboardMode is true; null carries the previous card gate state forward. */
    val card: CardDetection?,
    val cardboardMode: Boolean,
    val nowMs: Double,
    val distanceRange: DistanceRange = DISTANCE_GATE_DEFAULTS,
)

fun activeGateIds(cardboardMode: Boolean): List<SmartFrameGateId> {
    val base = listOf(
        SmartFrameGateId.FACE,
        SmartFrameGateId.PITCH,
        SmartFrameGateId.YAW,
        SmartFrameGateId.ROLL,
        SmartFrameGateId.DISTANCE,
        SmartFrameGateId.SMILE,
    )
    return if (cardboardMode) base + SmartFrameGateId.CARD else base
}
