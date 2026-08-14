package com.gavan.capture.gates

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ported 1:1 from capture-pwa/src/gates/captureArmEvaluator.test.ts. */
class CaptureArmEvaluatorTest {

    private val durationMs = 3000L

    private fun step(
        state: CaptureArmState,
        nowMs: Double,
        holdReached: Boolean = false,
        allPassed: Boolean = true,
        durationMs: Long = this.durationMs,
    ): CaptureArmEvaluation = evaluateCaptureArm(
        CaptureArmInputs(holdReached = holdReached, allPassed = allPassed, nowMs = nowMs, durationMs = durationMs),
        state,
    )

    @Test
    fun `stays idle and does nothing when holdReached is false`() {
        val evaluation = step(createInitialCaptureArmState(), 0.0, holdReached = false, allPassed = false)
        assertEquals(CaptureArmPhase.IDLE, evaluation.phase)
        assertNull(evaluation.displayTick)
        assertFalse(evaluation.tickJustChanged)
        assertFalse(evaluation.fireNow)
        assertFalse(evaluation.justCanceled)
    }

    @Test
    fun `starts counting exactly on the holdReached true-edge`() {
        val evaluation = step(createInitialCaptureArmState(), 1000.0, holdReached = true)
        assertEquals(CaptureArmPhase.COUNTING, evaluation.phase)
        assertEquals(3, evaluation.displayTick)
        assertTrue(evaluation.tickJustChanged)
    }

    @Test
    fun `counts down 3 to 2 to 1 at the right millisecond boundaries`() {
        var state = createInitialCaptureArmState()
        var evaluation = step(state, 0.0, holdReached = true)
        assertEquals(3, evaluation.displayTick)
        state = evaluation.state

        evaluation = step(state, 500.0)
        assertEquals(3, evaluation.displayTick)
        assertFalse(evaluation.tickJustChanged)
        state = evaluation.state

        evaluation = step(state, 1000.0)
        assertEquals(2, evaluation.displayTick)
        assertTrue(evaluation.tickJustChanged)
        state = evaluation.state

        evaluation = step(state, 1999.0)
        assertEquals(2, evaluation.displayTick)
        state = evaluation.state

        evaluation = step(state, 2000.0)
        assertEquals(1, evaluation.displayTick)
        assertTrue(evaluation.tickJustChanged)
        state = evaluation.state

        evaluation = step(state, 2999.0)
        assertEquals(1, evaluation.displayTick)
        assertEquals(CaptureArmPhase.COUNTING, evaluation.phase)
        assertFalse(evaluation.fireNow)
    }

    @Test
    fun `does not re-announce the same tick every frame`() {
        var state = createInitialCaptureArmState()
        var evaluation = step(state, 0.0, holdReached = true)
        state = evaluation.state
        evaluation = step(state, 100.0)
        assertFalse(evaluation.tickJustChanged)
        evaluation = step(evaluation.state, 200.0)
        assertFalse(evaluation.tickJustChanged)
    }

    @Test
    fun `fires exactly once, only after the full duration with allPassed held throughout`() {
        var state = createInitialCaptureArmState()
        var fireCount = 0
        var evaluation = step(state, 0.0, holdReached = true)
        state = evaluation.state
        if (evaluation.fireNow) fireCount++

        var t = 100.0
        while (t <= durationMs + 100) {
            evaluation = step(state, t)
            if (evaluation.fireNow) fireCount++
            state = evaluation.state
            t += 100
        }

        assertEquals(1, fireCount)
    }

    @Test
    fun `is idle again immediately after firing (self-resetting)`() {
        var state = createInitialCaptureArmState()
        var evaluation = step(state, 0.0, holdReached = true)
        state = evaluation.state
        evaluation = step(state, durationMs.toDouble())
        assertTrue(evaluation.fireNow)
        assertEquals(CaptureArmPhase.IDLE, evaluation.phase)
        assertEquals(CaptureArmPhase.IDLE, evaluation.state.phase)
    }

    @Test
    fun `cancels immediately (no fireNow ever) if allPassed drops mid-count`() {
        var state = createInitialCaptureArmState()
        var evaluation = step(state, 0.0, holdReached = true)
        state = evaluation.state
        evaluation = step(state, 1500.0)
        state = evaluation.state

        evaluation = step(state, 1600.0, allPassed = false)
        assertEquals(CaptureArmPhase.IDLE, evaluation.phase)
        assertTrue(evaluation.justCanceled)
        assertFalse(evaluation.fireNow)
        state = evaluation.state

        evaluation = step(state, 1700.0, allPassed = true, holdReached = false)
        assertEquals(CaptureArmPhase.IDLE, evaluation.phase)
    }

    @Test
    fun `cancels even one frame before the duration would have completed`() {
        var state = createInitialCaptureArmState()
        var evaluation = step(state, 0.0, holdReached = true)
        state = evaluation.state
        evaluation = step(state, durationMs - 1.0, allPassed = false)
        assertFalse(evaluation.fireNow)
        assertTrue(evaluation.justCanceled)
    }

    @Test
    fun `restarts the full countdown from the top on a fresh holdReached edge after a cancel`() {
        var state = createInitialCaptureArmState()
        var evaluation = step(state, 0.0, holdReached = true)
        state = evaluation.state
        evaluation = step(state, 2000.0)
        state = evaluation.state
        assertEquals(1, evaluation.displayTick)

        evaluation = step(state, 2100.0, allPassed = false)
        state = evaluation.state
        assertEquals(CaptureArmPhase.IDLE, state.phase)

        evaluation = step(state, 5000.0, holdReached = true)
        assertEquals(CaptureArmPhase.COUNTING, evaluation.phase)
        assertEquals(3, evaluation.displayTick)
    }

    @Test
    fun `re-derives displayTick sanely if durationMs changes mid-countdown`() {
        var state = createInitialCaptureArmState()
        var evaluation = step(state, 0.0, holdReached = true, durationMs = 3000L)
        state = evaluation.state

        evaluation = step(state, 500.0, durationMs = 1000L)
        assertEquals(CaptureArmPhase.COUNTING, evaluation.phase)
        state = evaluation.state

        evaluation = step(state, 1000.0, durationMs = 1000L)
        assertTrue(evaluation.fireNow)
    }
}
