package com.gavan.capture.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.hardware.camera2.CaptureRequest
import android.util.Size
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

enum class Facing { FRONT, REAR }

/**
 * CameraX-based capture pipeline. CameraX is still Camera2 underneath --
 * Google's official wrapper directly on top of it, not a lesser or
 * "web-ish" replacement -- but it owns preview sizing/scaling/rotation
 * via PreviewView (FILL_CENTER) and ImageAnalysis's own reported
 * `rotationDegrees`, instead of the hand-derived Matrix math this file
 * replaced (Camera2Controller.kt, removed). That hand-derived approach
 * got the rotation and/or distortion wrong on real hardware three
 * separate times across three attempts -- PreviewView + ImageAnalysis
 * are exactly the primitives MediaPipe's own official Android Face
 * Landmarker sample uses for this, so this now matches a working
 * reference implementation instead of inventing one blind.
 *
 * The "uplifted camera hardware" story is unchanged: Camera2Interop
 * (camera-camera2 artifact) exposes the exact same CONTROL_AE_LOCK /
 * CONTROL_AWB_LOCK CaptureRequest keys the old Camera2Controller used
 * directly -- still a real sensor-level lock, not a getUserMedia guess.
 */
class CameraXController(private val context: Context) {

    private val analysisExecutor: Executor = Executors.newSingleThreadExecutor()

    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var boundLifecycleOwner: LifecycleOwner? = null
    private var boundSelector: CameraSelector? = null

    private var previewUseCase: Preview? = null
    private var analysisUseCase: ImageAnalysis? = null
    private var imageCaptureUseCase: ImageCapture? = null
    private var videoCaptureUseCase: VideoCapture<Recorder>? = null

    private var activeRecording: Recording? = null
    private var videoOutputFile: File? = null
    private var aeLocked = false

    var onAnalysisFrame: ((Bitmap, Long) -> Unit)? = null
    var onError: ((String) -> Unit)? = null

    val isFrontFacing: Boolean
        get() = boundSelector == CameraSelector.DEFAULT_FRONT_CAMERA

    fun hasTorch(): Boolean = camera?.cameraInfo?.hasFlashUnit() == true

    /**
     * Binds preview + analysis + still-capture to the given lifecycle.
     * Video recording temporarily rebinds to preview + analysis + video
     * (dropping still-capture) in startVideoRecording/stopVideoRecording
     * -- deliberately kept to 3 concurrent streams at every point, same
     * as the original Camera2Controller, since 4 concurrent use cases
     * (preview+analysis+capture+video) isn't a combination every device's
     * hardware level guarantees.
     */
    suspend fun open(facing: Facing, previewView: PreviewView, lifecycleOwner: LifecycleOwner) {
        close()

        val provider = getProvider()
        cameraProvider = provider

        val selector = if (facing == Facing.FRONT) {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            CameraSelector.DEFAULT_BACK_CAMERA
        }
        boundLifecycleOwner = lifecycleOwner
        boundSelector = selector

        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(previewView.surfaceProvider)
        }
        val analysis = ImageAnalysis.Builder()
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
            .also { it.setAnalyzer(analysisExecutor) { proxy -> handleAnalysisFrame(proxy) } }
        val capture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
            .build()

        previewUseCase = preview
        analysisUseCase = analysis
        imageCaptureUseCase = capture
        // videoCaptureUseCase is intentionally NOT built here -- it needs
        // the caller's requested size/bitrate (see startVideoRecording),
        // which aren't known until a capture is actually triggered.

        try {
            provider.unbindAll()
            camera = provider.bindToLifecycle(lifecycleOwner, selector, preview, analysis, capture)
        } catch (e: Exception) {
            onError?.invoke("Camera bind failed: ${e.message}")
            throw e
        }
    }

    private suspend fun getProvider(): ProcessCameraProvider = suspendCoroutine { cont ->
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener(
            {
                try {
                    cont.resume(future.get())
                } catch (e: Exception) {
                    cont.resumeWithException(e)
                }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    private fun handleAnalysisFrame(imageProxy: ImageProxy) {
        try {
            val bitmap = rgbaImageProxyToBitmap(imageProxy)
            // ImageAnalysis reports the exact rotation needed to make
            // this frame upright, computed from the sensor's own
            // orientation plus the current display rotation -- no manual
            // derivation, which is the entire class of bug this
            // replacement exists to eliminate. Rotate only, never mirror
            // (mirroring stays a display-time-only transform, matching
            // the PWA and the calibrated angle-sign convention in
            // FaceLandmarkerTracker -- see that file's X_SIGN comment).
            val rotationDegrees = imageProxy.imageInfo.rotationDegrees
            val rotated = if (rotationDegrees != 0) rotateBitmap(bitmap, rotationDegrees) else bitmap
            onAnalysisFrame?.invoke(rotated, System.currentTimeMillis())
        } catch (e: Exception) {
            onError?.invoke("Analysis frame conversion failed: ${e.message}")
        } finally {
            imageProxy.close()
        }
    }

    /**
     * Real AE+AWB lock via Camera2Interop's CaptureRequestOptions --
     * still the literal CONTROL_AE_LOCK/CONTROL_AWB_LOCK CaptureRequest
     * keys, just set through CameraX's Camera2 escape hatch instead of a
     * hand-built CaptureRequest.Builder. Locking both together matches
     * what the PWA's tryLockCapture attempts (deviceCamera.ts).
     */
    fun setAeLock(locked: Boolean) {
        aeLocked = locked
        val cam = camera ?: return
        val camera2Control = Camera2CameraControl.from(cam.cameraControl)
        val options = CaptureRequestOptions.Builder()
            .setCaptureRequestOption(CaptureRequest.CONTROL_AE_LOCK, locked)
            .setCaptureRequestOption(CaptureRequest.CONTROL_AWB_LOCK, locked)
            .build()
        camera2Control.captureRequestOptions = options
    }

    fun setTorch(on: Boolean): Boolean {
        val cam = camera ?: return false
        if (!hasTorch()) return false
        cam.cameraControl.enableTorch(on)
        return true
    }

    /** Grabs one full-resolution JPEG still, independent of the analysis stream feeding the tracker. */
    suspend fun captureStillJpeg(): ByteArray = suspendCoroutine { cont ->
        val capture = imageCaptureUseCase ?: run {
            cont.resumeWithException(IllegalStateException("Camera not ready for still capture"))
            return@suspendCoroutine
        }
        capture.takePicture(
            analysisExecutor,
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    try {
                        val buffer = image.planes[0].buffer
                        val bytes = ByteArray(buffer.remaining())
                        buffer.get(bytes)
                        cont.resume(bytes)
                    } finally {
                        image.close()
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    cont.resumeWithException(exception)
                }
            },
        )
    }

    /**
     * Starts the supplementary "Active Sweep" video, mirroring
     * videoRecorder.ts: full camera frame, high target bitrate. Rebinds
     * to preview+analysis+video (dropping still-capture) for the
     * duration -- see open()'s doc comment on the 3-concurrent-stream
     * constraint.
     *
     * The Recorder is built here, not in open(), because it needs the
     * caller's requested videoSize/bitrateBps -- building it once with a
     * hardcoded Quality.HD in open() silently ignored both parameters
     * (including TARGET_VIDEO_BITRATE_BPS, the whole point of matching
     * videoRecorder.ts's high-bitrate intent).
     */
    suspend fun startVideoRecording(outputFile: File, videoSize: Size, bitrateBps: Int): Boolean {
        val provider = cameraProvider ?: return false
        val owner = boundLifecycleOwner ?: return false
        val selector = boundSelector ?: return false
        val preview = previewUseCase ?: return false
        val analysis = analysisUseCase ?: return false

        videoOutputFile = outputFile
        return try {
            val recorder = Recorder.Builder()
                .setQualitySelector(QualitySelector.from(qualityForSize(videoSize)))
                .setTargetVideoEncodingBitRate(bitrateBps)
                .build()
            val video = VideoCapture.withOutput(recorder)
            videoCaptureUseCase = video

            provider.unbindAll()
            camera = provider.bindToLifecycle(owner, selector, preview, analysis, video)
            if (aeLocked) setAeLock(true)

            val outputOptions = FileOutputOptions.Builder(outputFile).build()
            val hasAudioPermission = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO,
            ) == PackageManager.PERMISSION_GRANTED

            val pendingRecording = video.output.prepareRecording(context, outputOptions)
            @Suppress("MissingPermission")
            val recording = if (hasAudioPermission) pendingRecording.withAudioEnabled() else pendingRecording
            activeRecording = recording.start(analysisExecutor) { /* video/audio muxing runs regardless of event callbacks */ }
            true
        } catch (e: Exception) {
            onError?.invoke("Video recording start failed: ${e.message}")
            false
        }
    }

    /** Stops the sweep recording and rebinds back to preview+analysis+still-capture. */
    suspend fun stopVideoRecording(): File? {
        val recording = activeRecording
        recording?.stop()
        activeRecording = null

        val provider = cameraProvider
        val owner = boundLifecycleOwner
        val selector = boundSelector
        val preview = previewUseCase
        val analysis = analysisUseCase
        val capture = imageCaptureUseCase
        if (provider != null && owner != null && selector != null && preview != null && analysis != null && capture != null) {
            try {
                provider.unbindAll()
                camera = provider.bindToLifecycle(owner, selector, preview, analysis, capture)
                if (aeLocked) setAeLock(true)
            } catch (e: Exception) {
                onError?.invoke("Failed to restore preview session after recording: ${e.message}")
            }
        }
        return videoOutputFile
    }

    /** Maps a requested capture size to CameraX's discrete Quality tiers, favoring the tier that covers the request. */
    private fun qualityForSize(size: Size): Quality {
        val target = kotlin.math.max(size.width, size.height)
        return when {
            target >= 2160 -> Quality.UHD
            target >= 1080 -> Quality.FHD
            target >= 720 -> Quality.HD
            else -> Quality.SD
        }
    }

    fun close() {
        activeRecording?.stop()
        activeRecording = null
        cameraProvider?.unbindAll()
        camera = null
        previewUseCase = null
        analysisUseCase = null
        imageCaptureUseCase = null
        videoCaptureUseCase = null
        boundLifecycleOwner = null
        boundSelector = null
    }

    fun release() {
        close()
    }

    companion object {
        /**
         * ImageAnalysis's RGBA_8888 output is a single interleaved plane
         * (unlike YUV_420_888's three sub-sampled planes), so this is a
         * direct buffer copy -- no NV21/JPEG round-trip needed, which is
         * both simpler and cheaper than the YUV conversion this replaced.
         */
        fun rgbaImageProxyToBitmap(imageProxy: ImageProxy): Bitmap {
            val plane = imageProxy.planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPaddingPixels = (rowStride - pixelStride * imageProxy.width) / pixelStride

            val bitmap = Bitmap.createBitmap(
                imageProxy.width + rowPaddingPixels,
                imageProxy.height,
                Bitmap.Config.ARGB_8888,
            )
            bitmap.copyPixelsFromBuffer(buffer)

            return if (rowPaddingPixels == 0) {
                bitmap
            } else {
                Bitmap.createBitmap(bitmap, 0, 0, imageProxy.width, imageProxy.height)
            }
        }

        fun rotateBitmap(bitmap: Bitmap, degrees: Int): Bitmap {
            if (degrees == 0) return bitmap
            val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
            return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        }
    }
}
