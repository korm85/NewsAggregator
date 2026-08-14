package com.gavan.capture.gates

import com.gavan.capture.config.DistanceRange
import com.gavan.capture.tracker.MouthBox
import com.gavan.capture.tracker.TrackerResult
import com.gavan.capture.tracker.Vec2
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ported 1:1 from capture-pwa/src/gates/smartFrameEvaluator.test.ts. */
class SmartFrameEvaluatorTest {

    private fun tracker(
        detected: Boolean = true,
        mouthBox: MouthBox? = MouthBox(0.4, 0.425, 0.2, 0.15),
        offAxisVec: Vec2 = Vec2(0.0, 0.0),
        rollDeg: Double = 0.0,
        yawDeg: Double = 0.0,
        pitchDeg: Double = 0.0,
        mar: Double = 0.25,
        smileWidthRatio: Double = 0.65,
    ) = TrackerResult(
        detected = detected,
        mouthBox = mouthBox,
        offAxisDeg = 0.0,
        offAxisVec = offAxisVec,
        rollDeg = rollDeg,
        yawDeg = yawDeg,
        pitchDeg = pitchDeg,
        mar = mar,
        smileWidthRatio = smileWidthRatio,
        landmarkChecksum = 1000.0,
        lipPoints = null,
    )

    private fun card(allMarkersVisible: Boolean = true, isFlat: Boolean = true) =
        CardDetection(allMarkersVisible = allMarkersVisible, isFlat = isFlat, markerIds = listOf(0, 1, 2, 3))

    private data class RunResult(val evaluation: SmartFrameEvaluation, val state: SmartFrameGateState, val now: Double)

    private fun run(
        state: SmartFrameGateState,
        tracker: TrackerResult,
        frames: Int,
        startMs: Double,
        card: CardDetection? = null,
        cardboardMode: Boolean = false,
        distanceRange: DistanceRange = com.gavan.capture.config.DISTANCE_GATE_DEFAULTS,
    ): RunResult {
        var s = state
        var evaluation: SmartFrameEvaluation? = null
        var now = startMs
        repeat(frames) {
            evaluation = evaluateSmartFrame(
                SmartFrameInputs(tracker, card, cardboardMode, now, distanceRange),
                s,
            )
            s = evaluation!!.state
            now += 40
        }
        return RunResult(evaluation!!, s, now)
    }

    @Test
    fun `passes at 15 degrees, fails at 19, both pitch and yaw independently`() {
        val pitchOk = run(SmartFrameGateState(), tracker(pitchDeg = 15.0), 1, 0.0)
        assertTrue(pitchOk.evaluation.gateStatuses.pitch)

        val pitchBad = run(SmartFrameGateState(), tracker(pitchDeg = 19.0), 1, 0.0)
        assertFalse(pitchBad.evaluation.gateStatuses.pitch)

        val yawOk = run(SmartFrameGateState(), tracker(yawDeg = -15.0), 1, 0.0)
        assertTrue(yawOk.evaluation.gateStatuses.yaw)

        val yawBad = run(SmartFrameGateState(), tracker(yawDeg = -19.0), 1, 0.0)
        assertFalse(yawBad.evaluation.gateStatuses.yaw)
    }

    @Test
    fun `pitch does not flicker once green (hysteresis band)`() {
        var r = run(SmartFrameGateState(), tracker(pitchDeg = 5.0), 1, 0.0)
        r = run(r.state, tracker(pitchDeg = 17.0), 1, r.now)
        assertTrue(r.evaluation.gateStatuses.pitch)
        r = run(r.state, tracker(pitchDeg = 18.5), 1, r.now)
        assertFalse(r.evaluation.gateStatuses.pitch)
    }

    @Test
    fun `roll passes at 5 degrees, fails at 6, both signs`() {
        val ok = run(SmartFrameGateState(), tracker(rollDeg = 5.0), 1, 0.0)
        assertTrue(ok.evaluation.gateStatuses.roll)

        val bad = run(SmartFrameGateState(), tracker(rollDeg = -6.5), 1, 0.0)
        assertFalse(bad.evaluation.gateStatuses.roll)
    }

    @Test
    fun `roll does not flicker once passing (hysteresis band)`() {
        var r = run(SmartFrameGateState(), tracker(rollDeg = 2.0), 1, 0.0)
        r = run(r.state, tracker(rollDeg = 5.5), 1, r.now)
        assertTrue(r.evaluation.gateStatuses.roll)
        r = run(r.state, tracker(rollDeg = 6.5), 1, r.now)
        assertFalse(r.evaluation.gateStatuses.roll)
    }

    @Test
    fun `distance gate passes within default range, fails outside it`() {
        val ok = run(SmartFrameGateState(), tracker(mouthBox = MouthBox(0.4, 0.425, 0.2, 0.15)), 1, 0.0)
        assertTrue(ok.evaluation.gateStatuses.distance)

        val tooClose = run(SmartFrameGateState(), tracker(mouthBox = MouthBox(0.35, 0.4, 0.35, 0.2)), 1, 0.0)
        assertFalse(tooClose.evaluation.gateStatuses.distance)
        assertEquals("Move back", tooClose.evaluation.prompt)

        val tooFar = run(SmartFrameGateState(), tracker(mouthBox = MouthBox(0.45, 0.45, 0.08, 0.08)), 1, 0.0)
        assertFalse(tooFar.evaluation.gateStatuses.distance)
        assertEquals("Move closer", tooFar.evaluation.prompt)
    }

    @Test
    fun `honors a runtime-adjustable distanceRange over the default`() {
        val evaluation = evaluateSmartFrame(
            SmartFrameInputs(tracker(), null, false, 0.0, DistanceRange(0.28, 0.35)),
            SmartFrameGateState(),
        )
        assertFalse(evaluation.gateStatuses.distance)
        assertFalse(evaluation.allPassed)
    }

    @Test
    fun `distance does not flicker once passing (hysteresis buffer)`() {
        var r = run(SmartFrameGateState(), tracker(mouthBox = MouthBox(0.4, 0.425, 0.2, 0.15)), 1, 0.0)
        // Just above max (0.25) but inside the hysteresis buffer (0.02).
        r = run(r.state, tracker(mouthBox = MouthBox(0.38, 0.42, 0.26, 0.16)), 1, r.now)
        assertTrue(r.evaluation.gateStatuses.distance)
        r = run(r.state, tracker(mouthBox = MouthBox(0.37, 0.41, 0.28, 0.17)), 1, r.now)
        assertFalse(r.evaluation.gateStatuses.distance)
    }

    @Test
    fun `fails a literally closed mouth (mar floor) even with a wide-ratio mouth`() {
        val r = run(SmartFrameGateState(), tracker(mar = 0.02), 1, 0.0)
        assertFalse(r.evaluation.gateStatuses.smile)
        assertEquals("Ask the patient to smile wide", r.evaluation.prompt)
    }

    @Test
    fun `fails a narrow smile (width ratio) even with a wide-open mouth`() {
        val r = run(SmartFrameGateState(), tracker(mar = 0.78, smileWidthRatio = 0.35), 1, 0.0)
        assertFalse(r.evaluation.gateStatuses.smile)
    }

    @Test
    fun `passes a normal wide smile with teeth touching (low mar, high width ratio)`() {
        val r = run(SmartFrameGateState(), tracker(mar = 0.248, smileWidthRatio = 0.65), 1, 0.0)
        assertTrue(r.evaluation.gateStatuses.smile)
    }

    @Test
    fun `passes a mouth-agape wide smile too (both metrics high)`() {
        val r = run(SmartFrameGateState(), tracker(mar = 0.78, smileWidthRatio = 0.71), 1, 0.0)
        assertTrue(r.evaluation.gateStatuses.smile)
    }

    @Test
    fun `smile gate holds the pass through the exit band once entered (hysteresis)`() {
        val first = run(SmartFrameGateState(), tracker(mar = 0.25, smileWidthRatio = 0.65), 1, 0.0)
        val second = run(first.state, tracker(mar = 0.06, smileWidthRatio = 0.5), 1, first.now)
        assertTrue(second.evaluation.gateStatuses.smile)
    }

    @Test
    fun `ignores the card gate entirely when cardboardMode is off`() {
        val r = run(SmartFrameGateState(), tracker(), 1, 0.0, null, false)
        assertTrue(r.evaluation.allPassed)
    }

    @Test
    fun `requires all markers visible and flat when cardboardMode is on`() {
        val missing = run(SmartFrameGateState(), tracker(), 1, 0.0, card(allMarkersVisible = false), true)
        assertFalse(missing.evaluation.gateStatuses.card)
        assertFalse(missing.evaluation.allPassed)

        val tilted = run(SmartFrameGateState(), tracker(), 1, 0.0, card(isFlat = false), true)
        assertFalse(tilted.evaluation.gateStatuses.card)
        assertEquals("Hold the card flat and unobstructed", tilted.evaluation.prompt)

        val good = run(SmartFrameGateState(), tracker(), 1, 0.0, card(), true)
        assertTrue(good.evaluation.gateStatuses.card)
        assertTrue(good.evaluation.allPassed)
    }

    @Test
    fun `carries the previous card verdict forward when detection is throttled (card = null)`() {
        val first = run(SmartFrameGateState(), tracker(), 1, 0.0, card(), true)
        val second = run(first.state, tracker(), 1, first.now, null, true)
        assertTrue(second.evaluation.gateStatuses.card)
    }

    @Test
    fun `triggers capture exactly once after holdFramesRequired consecutive all-pass frames`() {
        var state = SmartFrameGateState()
        val goodTracker = tracker()
        var triggeredCount = 0
        var now = 0.0
        repeat(8) {
            val evaluation = evaluateSmartFrame(SmartFrameInputs(goodTracker, null, false, now), state)
            state = evaluation.state
            if (evaluation.captureTriggered) triggeredCount++
            now += 40
        }
        assertEquals(1, triggeredCount)
    }

    @Test
    fun `resets the hold count when any gate fails mid hold`() {
        var state = SmartFrameGateState()
        val goodTracker = tracker()
        val badTracker = tracker(pitchDeg = 30.0)
        var now = 0.0
        repeat(3) {
            val evaluation = evaluateSmartFrame(SmartFrameInputs(goodTracker, null, false, now), state)
            state = evaluation.state
            now += 40
        }
        val dropped = evaluateSmartFrame(SmartFrameInputs(badTracker, null, false, now), state)
        assertEquals(0, dropped.holdCount)
    }

    @Test
    fun `prompts to bring the smile into view when no face is detected`() {
        val r = run(SmartFrameGateState(), tracker(detected = false), 1, 0.0)
        assertEquals("Bring your smile into view", r.evaluation.prompt)
    }

    @Test
    fun `keeps showing a prompt for at least 800ms even if the failing gate changes`() {
        val state0 = SmartFrameGateState()
        val pitchFail = tracker(pitchDeg = 30.0)
        val first = evaluateSmartFrame(SmartFrameInputs(pitchFail, null, false, 0.0), state0)
        assertTrue(first.prompt != null)

        val smileFail = tracker(pitchDeg = 0.0, mar = 0.01, smileWidthRatio = 0.5)
        val second = evaluateSmartFrame(SmartFrameInputs(smileFail, null, false, 400.0), first.state)
        assertEquals(first.prompt, second.prompt)

        val third = evaluateSmartFrame(SmartFrameInputs(smileFail, null, false, 900.0), second.state)
        assertEquals("Ask the patient to smile wide", third.prompt)
    }
}
