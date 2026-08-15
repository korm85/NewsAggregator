package com.gavan.capture.gates

import kotlin.math.ceil
import kotlin.math.max

/**
 * Pure function, same contract as evaluateSmartFrame: deterministic
 * given (input, prevState), no timer access of its own. Mirrors
 * capture-pwa/src/gates/captureArmEvaluator.ts exactly.
 */
fun evaluateCaptureArm(input: CaptureArmInputs, prevState: CaptureArmState): CaptureArmEvaluation {
    val (holdReached, allPassed, nowMs, durationMs) = input

    if (prevState.phase == CaptureArmPhase.IDLE) {
        if (!holdReached) {
            return CaptureArmEvaluation(
                phase = CaptureArmPhase.IDLE,
                displayTick = null,
                tickJustChanged = false,
                fireNow = false,
                justCanceled = false,
                state = prevState,
            )
        }
        return evaluateCounting(
            CaptureArmState(phase = CaptureArmPhase.COUNTING, armedSince = nowMs, lastAnnouncedTick = -1),
            nowMs,
            durationMs,
        )
    }

    if (!allPassed) {
        return CaptureArmEvaluation(
            phase = CaptureArmPhase.IDLE,
            displayTick = null,
            tickJustChanged = false,
            fireNow = false,
            justCanceled = true,
            state = createInitialCaptureArmState(),
        )
    }
    return evaluateCounting(prevState, nowMs, durationMs)
}

private fun evaluateCounting(state: CaptureArmState, nowMs: Double, durationMs: Long): CaptureArmEvaluation {
    val elapsed = nowMs - state.armedSince
    if (elapsed >= durationMs) {
        return CaptureArmEvaluation(
            phase = CaptureArmPhase.IDLE,
            displayTick = null,
            tickJustChanged = false,
            fireNow = true,
            justCanceled = false,
            state = createInitialCaptureArmState(),
        )
    }

    val remainingMs = max(0.0, durationMs - elapsed)
    val displayTick = max(1, ceil(remainingMs / 1000.0).toInt())
    val tickJustChanged = displayTick != state.lastAnnouncedTick
    val nextState = CaptureArmState(
        phase = CaptureArmPhase.COUNTING,
        armedSince = state.armedSince,
        lastAnnouncedTick = displayTick,
    )

    return CaptureArmEvaluation(
        phase = CaptureArmPhase.COUNTING,
        displayTick = displayTick,
        tickJustChanged = tickJustChanged,
        fireNow = false,
        justCanceled = false,
        state = nextState,
    )
}
