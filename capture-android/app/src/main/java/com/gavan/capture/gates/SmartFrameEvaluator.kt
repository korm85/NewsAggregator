package com.gavan.capture.gates

import com.gavan.capture.config.DISTANCE_GATE_HYSTERESIS
import com.gavan.capture.config.DistanceRange
import com.gavan.capture.config.MaxGateConfig
import com.gavan.capture.config.MinGateConfig
import com.gavan.capture.config.Thresholds
import com.gavan.capture.tracker.Vec2
import kotlin.math.abs

private fun passMax(value: Double, wasPassing: Boolean, cfg: MaxGateConfig): Boolean =
    if (wasPassing) value <= cfg.exitMax else value <= cfg.enterMax

private fun passMin(value: Double, wasPassing: Boolean, cfg: MinGateConfig): Boolean =
    if (wasPassing) value >= cfg.exitMin else value >= cfg.enterMin

/**
 * The distance gate's [min, max] range is runtime-adjustable, so unlike
 * the other gates it can't carry separate enter/exit bands baked into
 * config -- a fixed buffer is added outside whichever range is active
 * once passing, so the gate doesn't flicker at the edges.
 */
private fun passDistance(value: Double, wasPassing: Boolean, range: DistanceRange): Boolean {
    val buffer = if (wasPassing) DISTANCE_GATE_HYSTERESIS else 0.0
    return value >= range.min - buffer && value <= range.max + buffer
}

/**
 * Pure function: deterministic given the same inputs + prevState. Mirrors
 * capture-pwa/src/gates/smartFrameEvaluator.ts exactly, gate for gate.
 */
fun evaluateSmartFrame(input: SmartFrameInputs, prevState: SmartFrameGateState): SmartFrameEvaluation {
    val tracker = input.tracker
    val card = input.card
    val cardboardMode = input.cardboardMode
    val nowMs = input.nowMs
    val distanceRange = input.distanceRange
    val prevPassing = prevState.passing

    val passing: SmartFramePassingState = if (!tracker.detected) {
        prevPassing.copy(
            face = false,
            pitch = false,
            yaw = false,
            roll = false,
            distance = false,
            smile = false,
        )
    } else {
        val marOk = passMin(tracker.mar, prevPassing.smile, Thresholds.smileMar)
        val widthOk = passMin(tracker.smileWidthRatio, prevPassing.smile, Thresholds.smileWidth)
        prevPassing.copy(
            face = true,
            pitch = passMax(abs(tracker.pitchDeg), prevPassing.pitch, Thresholds.pitch),
            yaw = passMax(abs(tracker.yawDeg), prevPassing.yaw, Thresholds.yaw),
            roll = passMax(abs(tracker.rollDeg), prevPassing.roll, Thresholds.roll),
            distance = tracker.mouthBox?.let { passDistance(it.w, prevPassing.distance, distanceRange) } ?: false,
            smile = marOk && widthOk,
        )
    }

    // Card presence/flatness is a direct read of this frame's detection,
    // no hysteresis. A null card (detection throttled this frame) carries
    // the previous verdict forward instead of failing it.
    val passingWithCard = if (cardboardMode) {
        passing.copy(card = card?.let { it.allMarkersVisible && it.isFlat } ?: prevPassing.card)
    } else {
        passing.copy(card = true)
    }

    val gateOrder = activeGateIds(cardboardMode)
    val allPassed = gateOrder.all { passingWithCard[it] }
    val failingGate = gateOrder.firstOrNull { !passingWithCard[it] }

    val candidate = buildPrompt(failingGate, tracker.offAxisVec, card, tracker.mouthBox?.w, distanceRange)
    val promptChanged = candidate.text != prevState.currentPrompt

    val isLocked = prevState.promptSince != Double.NEGATIVE_INFINITY &&
        nowMs - prevState.promptSince < Thresholds.minPromptDisplayMs

    val currentPrompt: String?
    val arrowDirection: ArrowDirection?
    val promptSince: Double

    if (promptChanged && isLocked) {
        currentPrompt = prevState.currentPrompt
        arrowDirection = prevState.currentArrowDirection
        promptSince = prevState.promptSince
    } else if (promptChanged) {
        currentPrompt = candidate.text
        arrowDirection = candidate.direction
        promptSince = nowMs
    } else {
        currentPrompt = prevState.currentPrompt
        arrowDirection = prevState.currentArrowDirection
        promptSince = if (prevState.promptSince == Double.NEGATIVE_INFINITY) nowMs else prevState.promptSince
    }

    val holdCount = if (allPassed) prevState.holdCount + 1 else 0
    val captureTriggered = holdCount == Thresholds.holdFramesRequired

    val newState = SmartFrameGateState(
        passing = passingWithCard,
        currentPrompt = currentPrompt,
        currentArrowDirection = arrowDirection,
        promptSince = promptSince,
        holdCount = holdCount,
    )

    return SmartFrameEvaluation(
        gateStatuses = passingWithCard,
        allPassed = allPassed,
        captureTriggered = captureTriggered,
        holdCount = holdCount,
        holdRequired = Thresholds.holdFramesRequired,
        prompt = currentPrompt,
        arrowDirection = arrowDirection,
        frameColor = if (!tracker.detected) FrameColor.NONE else if (allPassed) FrameColor.GREEN else FrameColor.AMBER,
        state = newState,
    )
}

private data class PromptCandidate(val text: String?, val direction: ArrowDirection?)

private fun buildPrompt(
    failingGate: SmartFrameGateId?,
    offAxisVec: Vec2,
    card: CardDetection?,
    distanceRatio: Double?,
    distanceRange: DistanceRange,
): PromptCandidate {
    if (failingGate == null) return PromptCandidate(null, null)

    return when (failingGate) {
        SmartFrameGateId.FACE -> PromptCandidate("Bring your smile into view", null)
        SmartFrameGateId.PITCH, SmartFrameGateId.YAW -> {
            val (direction, text) = resolveAngleDirection(offAxisVec)
            PromptCandidate(text, direction)
        }
        SmartFrameGateId.ROLL -> PromptCandidate("Straighten your head", null)
        SmartFrameGateId.DISTANCE -> {
            val tooClose = distanceRatio != null && distanceRatio > distanceRange.max
            PromptCandidate(if (tooClose) "Move back" else "Move closer", null)
        }
        SmartFrameGateId.SMILE -> PromptCandidate("Ask the patient to smile wide", null)
        SmartFrameGateId.CARD -> {
            val text = if (card != null && !card.allMarkersVisible) {
                "Make sure all markers on the card are visible"
            } else {
                "Hold the card flat and unobstructed"
            }
            PromptCandidate(text, null)
        }
    }
}
