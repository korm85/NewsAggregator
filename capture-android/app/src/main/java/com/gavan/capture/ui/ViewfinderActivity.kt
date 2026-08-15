package com.gavan.capture.ui

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.View
import android.widget.SeekBar
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.gavan.capture.camera.CameraXController
import com.gavan.capture.camera.Facing
import com.gavan.capture.capture.CaptureSequence
import com.gavan.capture.capture.TrackerSnapshot
import com.gavan.capture.config.CAPTURE_ARM_DEFAULT_DURATION_MS
import com.gavan.capture.config.DISTANCE_GATE_DEFAULTS
import com.gavan.capture.config.DistanceRange
import com.gavan.capture.config.MAX_SESSION_CAPTURES
import com.gavan.capture.config.CaptureMode as ConfigCaptureMode
import com.gavan.capture.config.CAPTURE_MODE as DEFAULT_CAPTURE_MODE
import com.gavan.capture.databinding.ActivityViewfinderBinding
import com.gavan.capture.gates.CaptureArmInputs
import com.gavan.capture.gates.CaptureArmPhase
import com.gavan.capture.gates.CaptureArmState
import com.gavan.capture.gates.SmartFrameGateState
import com.gavan.capture.gates.SmartFrameInputs
import com.gavan.capture.gates.createInitialCaptureArmState
import com.gavan.capture.gates.evaluateCaptureArm
import com.gavan.capture.gates.evaluateSmartFrame
import com.gavan.capture.storage.CaptureRepository
import com.gavan.capture.tracker.FaceLandmarkerTracker
import com.gavan.capture.tracker.TrackerResult
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.max

private enum class TriggerMode { AUTO, MANUAL }

class ViewfinderActivity : AppCompatActivity() {

    private lateinit var binding: ActivityViewfinderBinding
    private lateinit var camera: CameraXController
    private lateinit var tracker: FaceLandmarkerTracker
    private lateinit var captureSequence: CaptureSequence
    private lateinit var repository: CaptureRepository

    private var currentFacing = if (DEFAULT_CAPTURE_MODE == ConfigCaptureMode.FRONT) Facing.FRONT else Facing.REAR
    private var smartFrameState = SmartFrameGateState()
    private var captureArmState = createInitialCaptureArmState()
    private var triggerMode = TriggerMode.AUTO
    private var sessionCaptureCount = 0
    private var capturing = false
    private var switchingCamera = false
    private var torchOn = false
    private var distanceRange = DISTANCE_GATE_DEFAULTS
    private var captureArmDurationMs = CAPTURE_ARM_DEFAULT_DURATION_MS
    private var latestTrackerResult = TrackerResult.EMPTY
    private var trackerReady = false

    // Dimensions of the most recent analysis frame actually delivered by
    // CameraX (post-rotation, from ImageAnalysis's own reported
    // rotationDegrees -- see CameraXController.handleAnalysisFrame), used
    // to map the tracker's normalized mouth-box coordinates onto the
    // PreviewView the same way PreviewView's own FILL_CENTER scale type
    // maps the camera buffer onto the screen. Written from the analysis
    // callback's background thread, read from the main thread in
    // onTrackerResult; a stale read is at worst one frame old and
    // cosmetically negligible, same informal threading already used for
    // latestTrackerResult below.
    private var lastAnalysisWidth = 0
    private var lastAnalysisHeight = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityViewfinderBinding.inflate(layoutInflater)
        setContentView(binding.root)

        camera = CameraXController(this)
        tracker = FaceLandmarkerTracker(this)
        captureSequence = CaptureSequence(this, File(cacheDir, "capture-tmp"))
        repository = CaptureRepository(this)

        binding.promptBanner.text = "Starting up..."
        binding.promptBanner.visibility = View.VISIBLE

        applyMirroring()
        wireControls()
        openCamera()

        lifecycleScope.launch {
            try {
                tracker.init { result ->
                    latestTrackerResult = result
                    runOnUiThread { onTrackerResult(result) }
                }
                trackerReady = true
            } catch (e: Exception) {
                binding.promptBanner.text = "Face tracker failed to start on this device: ${e.message}"
            }
        }
    }

    private fun applyMirroring() {
        // Camera buffer content is fed to the tracker unmirrored (see
        // CameraXController.handleAnalysisFrame's doc comment); mirroring
        // for the front camera is purely this display-time transform,
        // applied identically to the preview and the overlay so the
        // mouth box mirrors along with what's on screen.
        val mirrored = currentFacing == Facing.FRONT
        binding.previewView.scaleX = if (mirrored) -1f else 1f
        binding.overlayView.scaleX = if (mirrored) -1f else 1f
    }

    private fun openCamera() {
        lifecycleScope.launch {
            try {
                camera.onAnalysisFrame = { bitmap, timestampMs ->
                    lastAnalysisWidth = bitmap.width
                    lastAnalysisHeight = bitmap.height
                    if (trackerReady) tracker.detectAsync(bitmap, timestampMs)
                }
                camera.onError = { message -> runOnUiThread { binding.promptBanner.text = message } }
                camera.open(currentFacing, binding.previewView, this@ViewfinderActivity)
                runOnUiThread {
                    binding.promptBanner.visibility = View.GONE
                    binding.torchBtn.visibility = if (camera.hasTorch()) View.VISIBLE else View.GONE
                }
            } catch (e: Exception) {
                runOnUiThread { binding.promptBanner.text = "Camera failed to start: ${e.message}" }
            }
        }
    }

    /**
     * Maps the tracker's normalized (0-1) mouth-box coordinates -- which
     * are relative to the actual analysis frame CameraX just delivered --
     * onto the PreviewView's pixel space, replicating PreviewView's own
     * FILL_CENTER (center-crop, uniform scale, no distortion) behavior.
     * Recomputed from the real delivered frame dimensions on every
     * result, so unlike the old hand-rolled TextureView transform, this
     * doesn't depend on the analysis stream's resolution matching the
     * preview stream's -- whatever aspect ratio CameraX actually chose
     * for each is handled correctly by construction.
     */
    private fun updateOverlayTransform() {
        val bmpWidth = lastAnalysisWidth
        val bmpHeight = lastAnalysisHeight
        val viewWidth = binding.previewView.width
        val viewHeight = binding.previewView.height
        if (bmpWidth == 0 || bmpHeight == 0 || viewWidth == 0 || viewHeight == 0) return

        val coverScale = max(viewWidth.toFloat() / bmpWidth, viewHeight.toFloat() / bmpHeight)
        val scaledWidth = bmpWidth * coverScale
        val scaledHeight = bmpHeight * coverScale
        binding.overlayView.setContentTransform(
            scaledWidth,
            scaledHeight,
            (viewWidth - scaledWidth) / 2f,
            (viewHeight - scaledHeight) / 2f,
        )
    }

    private fun onTrackerResult(result: TrackerResult) {
        if (capturing || switchingCamera) return
        val now = System.currentTimeMillis().toDouble()
        updateOverlayTransform()

        val evaluation = evaluateSmartFrame(
            SmartFrameInputs(result, null, false, now, distanceRange),
            smartFrameState,
        )
        smartFrameState = evaluation.state

        val armGuardsOk = triggerMode == TriggerMode.AUTO && sessionCaptureCount < MAX_SESSION_CAPTURES
        val armEvaluation = if (armGuardsOk) {
            evaluateCaptureArm(
                CaptureArmInputs(evaluation.captureTriggered, evaluation.allPassed, now, captureArmDurationMs),
                captureArmState,
            )
        } else {
            null
        }
        captureArmState = armEvaluation?.state ?: createInitialCaptureArmState()

        if (armEvaluation?.tickJustChanged == true) {
            fireTickHaptic()
            playTickSound()
        }

        val counting = armEvaluation?.phase == CaptureArmPhase.COUNTING
        binding.overlayView.update(
            result.mouthBox,
            evaluation.frameColor,
            if (counting) null else evaluation.arrowDirection,
            if (counting) 0f else evaluation.holdCount.toFloat() / evaluation.holdRequired,
        )

        if (counting) {
            binding.promptBanner.text = "Hold that pose..."
            binding.promptBanner.visibility = View.VISIBLE
            binding.countdownNumeral.text = armEvaluation?.displayTick?.toString().orEmpty()
            binding.countdownNumeral.visibility = View.VISIBLE
        } else {
            binding.countdownNumeral.visibility = View.GONE
            if (evaluation.prompt != null) {
                binding.promptBanner.text = evaluation.prompt
                binding.promptBanner.visibility = View.VISIBLE
            } else {
                binding.promptBanner.visibility = View.GONE
            }
        }

        binding.shutterBtn.isEnabled = result.detected && !capturing

        if (armEvaluation?.fireNow == true && !capturing) {
            triggerCapture(result)
        }
    }

    private fun triggerCapture(result: TrackerResult) {
        capturing = true
        val snapshot = TrackerSnapshot(
            offAxisDeg = result.offAxisDeg,
            offAxisVec = result.offAxisVec,
            rollDeg = result.rollDeg,
            pitchDeg = result.pitchDeg,
            yawDeg = result.yawDeg,
            mar = result.mar,
            smileWidthRatio = result.smileWidthRatio,
            mouthBox = result.mouthBox,
        )
        val captureModeLabel = if (currentFacing == Facing.FRONT) "front" else "rear"

        lifecycleScope.launch {
            try {
                val captureResult = captureSequence.run(camera, snapshot, captureModeLabel)
                repository.save(captureResult, cardboardMode = false)
                sessionCaptureCount++
                binding.sessionBadge.text = "$sessionCaptureCount / $MAX_SESSION_CAPTURES"
                binding.sessionBadge.visibility = View.VISIBLE
            } catch (e: Exception) {
                binding.promptBanner.text = "Capture failed: ${e.message}"
                binding.promptBanner.visibility = View.VISIBLE
            } finally {
                capturing = false
                smartFrameState = SmartFrameGateState()
                captureArmState = createInitialCaptureArmState()
            }
        }
    }

    private fun wireControls() {
        binding.shutterBtn.setOnClickListener {
            if (triggerMode == TriggerMode.MANUAL && latestTrackerResult.detected && !capturing) {
                triggerCapture(latestTrackerResult)
            }
        }
        binding.modeAutoBtn.setOnClickListener { setTriggerMode(TriggerMode.AUTO) }
        binding.modeManualBtn.setOnClickListener { setTriggerMode(TriggerMode.MANUAL) }
        binding.galleryBtn.setOnClickListener {
            startActivity(android.content.Intent(this, GalleryActivity::class.java))
        }
        binding.torchBtn.setOnClickListener {
            torchOn = camera.setTorch(!torchOn)
        }
        binding.switchCameraBtn.setOnClickListener { switchCamera() }
        binding.debugBtn.setOnClickListener {
            binding.debugPanel.visibility = if (binding.debugPanel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        binding.distanceMinSeek.progress = (distanceRange.min * 200).toInt()
        binding.distanceMaxSeek.progress = (distanceRange.max * 200).toInt()
        binding.countdownDurationSeek.progress = captureArmDurationMs.toInt()

        val seekListener = object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                val min = binding.distanceMinSeek.progress / 200.0
                val max = binding.distanceMaxSeek.progress / 200.0
                if (max > min) distanceRange = DistanceRange(min, max)
                captureArmDurationMs = binding.countdownDurationSeek.progress.coerceAtLeast(500).toLong()
                binding.debugReadout.text = "distance ${"%.2f".format(distanceRange.min)}-${"%.2f".format(distanceRange.max)}  " +
                    "countdown ${captureArmDurationMs}ms"
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
            override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
        }
        binding.distanceMinSeek.setOnSeekBarChangeListener(seekListener)
        binding.distanceMaxSeek.setOnSeekBarChangeListener(seekListener)
        binding.countdownDurationSeek.setOnSeekBarChangeListener(seekListener)
    }

    private fun setTriggerMode(mode: TriggerMode) {
        triggerMode = mode
        smartFrameState = SmartFrameGateState()
        captureArmState = createInitialCaptureArmState()
        binding.modeAutoBtn.alpha = if (mode == TriggerMode.AUTO) 1f else 0.5f
        binding.modeManualBtn.alpha = if (mode == TriggerMode.MANUAL) 1f else 0.5f
    }

    private fun switchCamera() {
        if (switchingCamera) return
        switchingCamera = true
        currentFacing = if (currentFacing == Facing.FRONT) Facing.REAR else Facing.FRONT
        applyMirroring()
        smartFrameState = SmartFrameGateState()
        captureArmState = createInitialCaptureArmState()

        lifecycleScope.launch {
            try {
                camera.open(currentFacing, binding.previewView, this@ViewfinderActivity)
                binding.torchBtn.visibility = if (camera.hasTorch()) View.VISIBLE else View.GONE
                torchOn = false
            } catch (e: Exception) {
                binding.promptBanner.text = "Camera switch failed: ${e.message}"
                binding.promptBanner.visibility = View.VISIBLE
            } finally {
                switchingCamera = false
            }
        }
    }

    private fun fireTickHaptic() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(VIBRATOR_SERVICE) as Vibrator
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Shorter than the 60ms capture-confirm pulse in CaptureSequence, so a
                // mid-countdown tick doesn't feel like the final shutter confirm.
                vibrator.vibrate(VibrationEffect.createOneShot(25, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(25)
            }
        } catch (_: Exception) {
            // Best effort.
        }
    }

    private fun playTickSound() {
        try {
            // Higher/shorter than the capture-confirm beep in CaptureSequence.
            val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60)
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 80)
        } catch (_: Exception) {
            // Best effort.
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        camera.release()
        tracker.dispose()
    }
}
