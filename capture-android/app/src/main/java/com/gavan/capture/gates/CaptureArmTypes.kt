package com.gavan.capture.gates

/**
 * The "get ready" countdown between a Smart Frame gate hold completing
 * and capture actually firing -- self-timer/photo-booth style. Mirrors
 * capture-pwa/src/gates/captureArmTypes.ts.
 */
enum class CaptureArmPhase { IDLE, COUNTING }

data class CaptureArmState(
    val phase: CaptureArmPhase = CaptureArmPhase.IDLE,
    /** ms timestamp when counting started; -Infinity when idle. */
    val armedSince: Double = Double.NEGATIVE_INFINITY,
    /** Whole seconds remaining last reported; -1 when idle. */
    val lastAnnouncedTick: Int = -1,
)

data class CaptureArmInputs(
    /** One-shot "just reached holdFramesRequired" edge. Ignored once already counting. */
    val holdReached: Boolean,
    /** Continuous "are all active gates passing this frame" signal. Any false while counting cancels immediately. */
    val allPassed: Boolean,
    val nowMs: Double,
    /** Runtime-adjustable countdown length, read fresh each call. */
    val durationMs: Long,
)

data class CaptureArmEvaluation(
    val phase: CaptureArmPhase,
    /** Whole seconds remaining, e.g. 3, 2, 1; null when idle. */
    val displayTick: Int?,
    /** True exactly once per second boundary, including the first tick. */
    val tickJustChanged: Boolean,
    /** True exactly once: the frame capture should actually start. */
    val fireNow: Boolean,
    /** True exactly once: a mid-count gate failure reset this to idle. */
    val justCanceled: Boolean,
    val state: CaptureArmState,
)

fun createInitialCaptureArmState() = CaptureArmState()
