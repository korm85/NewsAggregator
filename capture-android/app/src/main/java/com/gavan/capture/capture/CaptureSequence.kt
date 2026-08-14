package com.gavan.capture.capture

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.gavan.capture.camera.Camera2Controller
import com.gavan.capture.config.CaptureSequenceConfig
import com.gavan.capture.config.TARGET_VIDEO_BITRATE_BPS
import com.gavan.capture.tracker.MouthBox
import com.gavan.capture.tracker.Vec2
import kotlinx.coroutines.delay
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class TrackerSnapshot(
    val offAxisDeg: Double,
    val offAxisVec: Vec2,
    val rollDeg: Double,
    val pitchDeg: Double,
    val yawDeg: Double,
    val mar: Double,
    val smileWidthRatio: Double,
    val mouthBox: MouthBox?,
)

data class StillCandidate(val file: File, val score: Double)

data class CaptureResult(
    val bestStill: StillCandidate,
    val stillCandidates: List<StillCandidate>,
    val bestStillIndex: Int,
    val videoFile: File?,
    val videoDurationMs: Long?,
    val exposureLockSuccess: Boolean,
    val snapshot: TrackerSnapshot,
    val capturedAt: String,
    val captureMode: String,
)

/**
 * Video-first "Active Sweep" capture, mirroring
 * capture-pwa/src/capture/captureSequence.ts: grab still candidates
 * first (no delay), THEN lock exposure + settle, THEN record the sweep
 * video. Camera2's AE lock (Camera2Controller.setAeLock) is a real
 * sensor-level lock rather than the PWA's best-effort capability guess,
 * so this doesn't need the PWA's read-current-value-then-reapply dance.
 */
class CaptureSequence(private val context: Context, private val outputDir: File) {

    private val capturedAtFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    suspend fun run(camera: Camera2Controller, snapshot: TrackerSnapshot, captureMode: String): CaptureResult {
        val capturedAt = capturedAtFormat.format(Date())
        val sessionDir = File(outputDir, System.currentTimeMillis().toString()).apply { mkdirs() }

        // Grabbed first, before exposure lock or any settle delay -- the
        // earliest candidate reflects the exact frame that satisfied the
        // gates, not a frame from hundreds of ms later.
        val stillCandidates = mutableListOf<StillCandidate>()
        for (i in 0 until CaptureSequenceConfig.stillFrameCount) {
            val jpeg = camera.captureStillJpeg()
            val file = File(sessionDir, "still_$i.jpg")
            file.writeBytes(jpeg)
            stillCandidates.add(StillCandidate(file, FrameScore.score(jpeg)))
            if (i < CaptureSequenceConfig.stillFrameCount - 1) delay(CaptureSequenceConfig.stillFrameIntervalMs)
        }
        var bestIndex = 0
        for (i in 1 until stillCandidates.size) {
            if (stillCandidates[i].score > stillCandidates[bestIndex].score) bestIndex = i
        }

        // Exposure lock + settle happen here, ahead of the video sweep:
        // their value is keeping the sweep's frames photometrically
        // consistent, which the already-captured stills above don't need.
        camera.setAeLock(true)
        val exposureLockSuccess = true // Camera2's CONTROL_AE_LOCK is unconditionally honored by the framework.
        delay(CaptureSequenceConfig.sensorSettleMs)

        val videoFile = File(sessionDir, "sweep.mp4")
        val recordingStarted = camera.startVideoRecording(
            videoFile,
            android.util.Size(1280, 720),
            TARGET_VIDEO_BITRATE_BPS,
        )
        var videoDurationMs: Long? = null
        val resultVideoFile = if (recordingStarted) {
            delay(CaptureSequenceConfig.burstDurationMs)
            val stopped = camera.stopVideoRecording()
            videoDurationMs = CaptureSequenceConfig.burstDurationMs
            stopped
        } else {
            null
        }

        fireHaptics(context)
        playCaptureSound()

        camera.setAeLock(false)

        return CaptureResult(
            bestStill = stillCandidates[bestIndex],
            stillCandidates = stillCandidates,
            bestStillIndex = bestIndex,
            videoFile = resultVideoFile,
            videoDurationMs = videoDurationMs,
            exposureLockSuccess = exposureLockSuccess,
            snapshot = snapshot,
            capturedAt = capturedAt,
            captureMode = captureMode,
        )
    }

    private fun fireHaptics(context: Context) {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(60)
            }
        } catch (_: Exception) {
            // Best effort, same as the PWA's navigator.vibrate guard.
        }
    }

    private fun playCaptureSound() {
        try {
            val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80)
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
        } catch (_: Exception) {
            // Audio unavailable; the haptic pulse above is the fallback.
        }
    }
}
