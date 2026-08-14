package com.gavan.capture.tracker

/**
 * Layer 1 output contract, mirroring capture-pwa/src/tracker/types.ts.
 * Everything outside the tracker package only ever sees this shape, so
 * the tracking engine stays swappable.
 */

data class MouthBox(val x: Double, val y: Double, val w: Double, val h: Double)

data class Vec2(val x: Double, val y: Double)

data class TrackerResult(
    val detected: Boolean,
    /** Normalized 0-1, padded and EMA-smoothed. Null when no face detected. */
    val mouthBox: MouthBox?,
    /** Combined yaw + pitch off the camera normal, degrees, always >= 0. */
    val offAxisDeg: Double,
    /** Signed unit-ish vector, camera-space x/y, for direction hints. */
    val offAxisVec: Vec2,
    val rollDeg: Double,
    val yawDeg: Double,
    val pitchDeg: Double,
    /** Mouth Aspect Ratio: inner-lip vertical gap / mouth width. Mouth-open floor only, not the smile-width signal. */
    val mar: Double,
    /** Mouth width / interocular distance -- the primary "smiling wide" signal. */
    val smileWidthRatio: Double,
    /** Sum of outer-lip landmark pixel coordinates, cheap frame-to-frame motion signal. */
    val landmarkChecksum: Double,
    /** Normalized 0-1 outer-lip contour points, for drawing guide dots. Null when no face detected. */
    val lipPoints: List<Vec2>?,
) {
    companion object {
        val EMPTY = TrackerResult(
            detected = false,
            mouthBox = null,
            offAxisDeg = 0.0,
            offAxisVec = Vec2(0.0, 0.0),
            rollDeg = 0.0,
            yawDeg = 0.0,
            pitchDeg = 0.0,
            mar = 0.0,
            smileWidthRatio = 0.0,
            landmarkChecksum = 0.0,
            lipPoints = null,
        )
    }
}
