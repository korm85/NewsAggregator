package com.gavan.capture.tracker

import android.content.Context
import android.graphics.Bitmap
import com.gavan.capture.config.MODEL_ASSET_PATH
import com.gavan.capture.config.Thresholds
import com.gavan.capture.config.TRACKER_INIT_TIMEOUT_MS
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import kotlinx.coroutines.withTimeout
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.min

/**
 * Android counterpart to capture-pwa/src/tracker/mediapipeTracker.ts,
 * using the official Android tasks-vision AAR (LIVE_STREAM mode) against
 * the exact same face_landmarker.task model file instead of the wasm
 * runtime. The angle/MAR/smile-width math below is a direct, unchanged
 * port -- these two apps should track the same face the same way, so any
 * comparison between them is about camera/hardware quality, not tracking
 * math drift.
 */

private val OUTER_LIP_INDICES = intArrayOf(
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0,
    37, 39, 40, 185,
)
private const val INNER_LIP_TOP = 13
private const val INNER_LIP_BOTTOM = 14
private const val RIGHT_EYE_OUTER = 33
private const val LEFT_EYE_OUTER = 263

/** Same sign convention as mediapipeTracker.ts, verified on-device there. */
private const val X_SIGN = -1.0
private const val Y_SIGN = 1.0

class FaceLandmarkerTracker(private val context: Context) {

    private var landmarker: FaceLandmarker? = null
    private var smoothedBox: MouthBox? = null
    private var latestResult: TrackerResult = TrackerResult.EMPTY
    private var onResult: ((TrackerResult) -> Unit)? = null

    suspend fun init(onResult: (TrackerResult) -> Unit) {
        this.onResult = onResult
        withTimeout(TRACKER_INIT_TIMEOUT_MS) {
            landmarker = try {
                createLandmarker(Delegate.GPU)
            } catch (e: Exception) {
                // GPU delegate isn't guaranteed on every device; CPU is
                // the universally-supported fallback (same fix applied
                // to the PWA's tracker after an on-device GPU-init hang).
                createLandmarker(Delegate.CPU)
            }
        }
    }

    private fun createLandmarker(delegate: Delegate): FaceLandmarker {
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath(MODEL_ASSET_PATH)
            .setDelegate(delegate)
            .build()

        val options = FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.LIVE_STREAM)
            .setNumFaces(1)
            .setOutputFacialTransformationMatrixes(true)
            .setResultListener { result, _ -> handleResult(result) }
            .setErrorListener { /* Surface via EMPTY result; caller keeps last-known state. */ }
            .build()

        return FaceLandmarker.createFromOptions(context, options)
    }

    /** Feed one analysis frame. Fire-and-forget: results arrive via the resultListener asynchronously. */
    fun detectAsync(bitmap: Bitmap, timestampMs: Long) {
        val mpImage = BitmapImageBuilder(bitmap).build()
        try {
            landmarker?.detectAsync(mpImage, timestampMs)
        } catch (_: Exception) {
            // Timestamps must be monotonically increasing; a stray
            // out-of-order frame is dropped rather than crashing the
            // analysis loop.
        }
    }

    fun latest(): TrackerResult = latestResult

    fun dispose() {
        landmarker?.close()
        landmarker = null
        smoothedBox = null
    }

    private fun handleResult(result: FaceLandmarkerResult) {
        val landmarks = result.faceLandmarks().firstOrNull()
        val matrixOptional = result.facialTransformationMatrixes()
        val matrix = if (matrixOptional.isPresent && matrixOptional.get().isNotEmpty()) matrixOptional.get()[0] else null

        if (landmarks == null || matrix == null) {
            smoothedBox = null
            latestResult = TrackerResult.EMPTY
            onResult?.invoke(latestResult)
            return
        }

        val angles = computeAngles(matrix)
        val (box, checksum, points) = computeMouthBox(landmarks)
        val mar = computeMar(landmarks)
        val smileWidthRatio = computeSmileWidthRatio(landmarks)

        smoothedBox = smoothBox(smoothedBox, box, Thresholds.mouthBoxSmoothingAlpha)

        latestResult = TrackerResult(
            detected = true,
            mouthBox = smoothedBox,
            offAxisDeg = angles.offAxisDeg,
            offAxisVec = angles.offAxisVec,
            rollDeg = angles.rollDeg,
            yawDeg = angles.yawDeg,
            pitchDeg = angles.pitchDeg,
            mar = mar,
            smileWidthRatio = smileWidthRatio,
            landmarkChecksum = checksum,
            lipPoints = points,
        )
        onResult?.invoke(latestResult)
    }

    private data class Angles(val offAxisDeg: Double, val offAxisVec: Vec2, val rollDeg: Double, val yawDeg: Double, val pitchDeg: Double)

    /** m is 16 floats, column-major. Column 2 is the face forward axis in camera space. */
    private fun computeAngles(m: FloatArray): Angles {
        val fx = m[8].toDouble()
        val fy = m[9].toDouble()
        val fz = m[10].toDouble()
        val n = hypot(hypot(fx, fy), fz).takeIf { it != 0.0 } ?: 1.0

        val offAxisDeg = Math.toDegrees(Math.acos(min(1.0, abs(fz) / n)))
        val offAxisVec = Vec2((X_SIGN * fx) / n, (Y_SIGN * fy) / n)
        val yawDeg = Math.toDegrees(X_SIGN * atan2(fx, fz))
        val pitchDeg = Math.toDegrees(Y_SIGN * atan2(fy, fz))
        val rollDeg = Math.toDegrees(atan2(m[4].toDouble(), m[5].toDouble()))

        return Angles(offAxisDeg, offAxisVec, rollDeg, yawDeg, pitchDeg)
    }

    private fun lm(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>, idx: Int) =
        landmarks.getOrNull(idx)

    private fun computeMar(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Double {
        val top = lm(landmarks, INNER_LIP_TOP) ?: return 0.0
        val bottom = lm(landmarks, INNER_LIP_BOTTOM) ?: return 0.0
        val left = lm(landmarks, OUTER_LIP_INDICES[0]) ?: return 0.0
        val right = lm(landmarks, 291) ?: return 0.0

        // Normalized coordinates: aspect ratios cancel the width/height
        // scale as long as both distances use the same (x, y) units, so
        // no pixel-space conversion is needed here.
        val verticalGap = hypot((top.x() - bottom.x()).toDouble(), (top.y() - bottom.y()).toDouble())
        val mouthWidth = hypot((left.x() - right.x()).toDouble(), (left.y() - right.y()).toDouble())
        if (mouthWidth == 0.0) return 0.0
        return verticalGap / mouthWidth
    }

    private fun computeSmileWidthRatio(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Double {
        val rightEye = lm(landmarks, RIGHT_EYE_OUTER) ?: return 0.0
        val leftEye = lm(landmarks, LEFT_EYE_OUTER) ?: return 0.0
        val left = lm(landmarks, OUTER_LIP_INDICES[0]) ?: return 0.0
        val right = lm(landmarks, 291) ?: return 0.0

        val interocularDist = hypot((rightEye.x() - leftEye.x()).toDouble(), (rightEye.y() - leftEye.y()).toDouble())
        val mouthWidth = hypot((left.x() - right.x()).toDouble(), (left.y() - right.y()).toDouble())
        if (interocularDist == 0.0) return 0.0
        return mouthWidth / interocularDist
    }

    private data class MouthBoxResult(val box: MouthBox, val checksum: Double, val points: List<Vec2>)

    private fun computeMouthBox(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): MouthBoxResult {
        var minX = Double.POSITIVE_INFINITY
        var minY = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var maxY = Double.NEGATIVE_INFINITY
        var checksum = 0.0
        val points = mutableListOf<Vec2>()

        for (idx in OUTER_LIP_INDICES) {
            val point = lm(landmarks, idx) ?: continue
            val x = point.x().toDouble()
            val y = point.y().toDouble()
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
            checksum += x + y
            points.add(Vec2(x, y))
        }

        val rawW = maxX - minX
        val rawH = maxY - minY
        val pad = Thresholds.mouthBoxPadding

        val box = MouthBox(
            x = minX - rawW * pad,
            y = minY - rawH * pad,
            w = rawW * (1 + 2 * pad),
            h = rawH * (1 + 2 * pad),
        )
        return MouthBoxResult(box, checksum, points)
    }

    private fun smoothBox(prev: MouthBox?, next: MouthBox, alpha: Double): MouthBox {
        if (prev == null) return next
        return MouthBox(
            x = prev.x + alpha * (next.x - prev.x),
            y = prev.y + alpha * (next.y - prev.y),
            w = prev.w + alpha * (next.w - prev.w),
            h = prev.h + alpha * (next.h - prev.h),
        )
    }
}
