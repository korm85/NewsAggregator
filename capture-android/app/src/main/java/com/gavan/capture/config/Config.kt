package com.gavan.capture.config

/**
 * Single source of truth for capture tuning -- a 1:1 port of
 * capture-pwa/src/config.ts. Every threshold here should stay in sync
 * with that file; this native app and the PWA are meant to be directly
 * comparable, not divergent products.
 */

enum class CaptureMode { FRONT, REAR }

/** Config decision open per the PWA's handoff Section 10; both paths are implemented, this switches between them. */
val CAPTURE_MODE = CaptureMode.FRONT

/** Front camera is shown mirrored (selfie convention); every mirroring decision must read from this constant. */
val MIRRORED = CAPTURE_MODE == CaptureMode.FRONT

data class MaxGateConfig(val enterMax: Double, val exitMax: Double)

/** Opposite of MaxGateConfig: must be AT LEAST this value to pass, exit band is lower than enter. */
data class MinGateConfig(val enterMin: Double, val exitMin: Double)

data class DistanceRange(val min: Double, val max: Double)

/**
 * Distance gate defaults: mouth-box width as a fraction of frame width.
 * 0.15-0.25 approximates 15-25cm from camera to face -- a starting
 * estimate, not yet calibrated against a real capture set. Runtime-
 * adjustable via the viewfinder's debug panel.
 */
val DISTANCE_GATE_DEFAULTS = DistanceRange(min = 0.15, max = 0.25)

/** Buffer added outside [min, max] before an already-passing distance gate exits. */
const val DISTANCE_GATE_HYSTERESIS = 0.02

/**
 * Self-timer-style "get ready" window between gates aligning and capture
 * actually firing (3-2-1 style). 3000ms is the standard shortest
 * self-timer duration across mainstream camera apps -- a pattern-matched
 * starting guess, not yet validated on this app specifically.
 * Runtime-adjustable via the debug panel.
 */
const val CAPTURE_ARM_DEFAULT_DURATION_MS = 3000L

object Thresholds {
    /** Smart Frame spec: max ~15 degrees variance on each axis independently. */
    val pitch = MaxGateConfig(enterMax = 15.0, exitMax = 18.0)
    val yaw = MaxGateConfig(enterMax = 15.0, exitMax = 18.0)
    val roll = MaxGateConfig(enterMax = 5.0, exitMax = 6.0)

    /** MAR is a mouth-OPEN floor only, not the "smiling wide" signal -- see smileWidth. */
    val smileMar = MinGateConfig(enterMin = 0.08, exitMin = 0.05)

    /** Mouth width / interocular distance -- the actual "smiling wide" signal. */
    val smileWidth = MinGateConfig(enterMin = 0.55, exitMin = 0.45)

    /** Consecutive all-pass frames required before the get-ready countdown starts. */
    const val holdFramesRequired = 5

    /** Minimum time a prompt stays on screen before it can be replaced. */
    const val minPromptDisplayMs = 800L

    /** Mouth bounding-box padding, each side, as a fraction of box size. */
    const val mouthBoxPadding = 0.15

    /** EMA smoothing factor for the mouth box across frames. */
    const val mouthBoxSmoothingAlpha = 0.3
}

object CaptureSequenceConfig {
    const val ringFillMs = 400L

    /**
     * Three still candidates are grabbed in rapid succession right at the
     * trigger instant, spaced stillFrameIntervalMs apart to cover a
     * typical blink (100-400ms) -- see captureSequence.ts for the full
     * rationale this mirrors.
     */
    const val stillFrameCount = 3
    const val stillFrameIntervalMs = 120L
    const val sensorSettleMs = 500L

    /** The "Active Sweep" window: video records for this long after the stills are grabbed and AE is locked. */
    const val burstDurationMs = 5000L
}

/** Target bitrate for the supplementary sweep video (MediaRecorder). */
const val TARGET_VIDEO_BITRATE_BPS = 16_000_000

/**
 * v2: the viewfinder keeps capturing so the user can build up a set of
 * shots to pick from, capped per session.
 */
const val MAX_SESSION_CAPTURES = 8

/** Bundled asset path for the MediaPipe Face Landmarker model (same .task file the PWA serves). */
const val MODEL_ASSET_PATH = "models/face_landmarker.task"

/**
 * Ceiling on how long FaceLandmarker initialization is allowed to take
 * before surfacing an error instead of hanging the loading screen --
 * same defensive fix applied to the PWA after a GPU-delegate init hang
 * left it stuck with no feedback.
 */
const val TRACKER_INIT_TIMEOUT_MS = 20_000L
