package com.gavan.capture.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.graphics.YuvImage
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.Image
import android.media.ImageReader
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import android.view.Surface
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

enum class Facing { FRONT, REAR }

/**
 * Native Camera2 pipeline: the "uplifted camera hardware" counterpart to
 * capture-pwa/src/capture/deviceCamera.ts's getUserMedia + applyConstraints
 * approach. Where the PWA has to read the browser's current auto-exposure
 * value and hope re-applying it as a capability-gated "manual" constraint
 * sticks (see deviceCamera.ts's tryLockCapture comment), this talks to the
 * sensor directly: CONTROL_AE_LOCK is a real, always-available capture
 * request key on any Camera2 device, not a best-effort browser capability
 * to probe for. Same for resolution -- StreamConfigurationMap exposes the
 * sensor's actual maximum output sizes, not a negotiated getUserMedia hint.
 */
class Camera2Controller(private val context: Context) {

    private val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    private val backgroundThread = HandlerThread("Camera2Controller").apply { start() }
    private val backgroundHandler = Handler(backgroundThread.looper)

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var characteristics: CameraCharacteristics? = null
    private var currentCameraId: String? = null
    private var repeatingRequestBuilder: CaptureRequest.Builder? = null

    private var previewSurface: Surface? = null
    private var analysisReader: ImageReader? = null
    private var stillReader: ImageReader? = null
    private var mediaRecorder: MediaRecorder? = null
    private var recorderSurface: Surface? = null
    private var videoOutputFile: File? = null

    var onAnalysisFrame: ((Bitmap, Long) -> Unit)? = null
    var onError: ((String) -> Unit)? = null

    val sensorOrientation: Int
        get() = characteristics?.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90

    val isFrontFacing: Boolean
        get() = characteristics?.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT

    fun hasTorch(): Boolean =
        characteristics?.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true

    fun cameraIdFor(facing: Facing): String? {
        val want = if (facing == Facing.FRONT) CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK
        return cameraManager.cameraIdList.firstOrNull { id ->
            cameraManager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == want
        }
    }

    /**
     * Opens the given facing, wiring a preview surface (from the
     * viewfinder's TextureView), a YUV analysis stream (feeding the face
     * tracker), and a JPEG still stream (max sensor resolution -- the
     * "uplifted" resolution ceiling a getUserMedia `ideal` hint can only
     * approximate, see deviceCamera.ts's pickMaxResolutionConstraints).
     */
    suspend fun open(facing: Facing, texture: SurfaceTexture, previewSize: Size) {
        close()

        val cameraId = cameraIdFor(facing) ?: cameraIdFor(if (facing == Facing.FRONT) Facing.REAR else Facing.FRONT)
            ?: throw IllegalStateException("No camera available on this device")
        val chars = cameraManager.getCameraCharacteristics(cameraId)
        characteristics = chars
        currentCameraId = cameraId

        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?: throw IllegalStateException("Camera $cameraId exposes no stream configuration map")

        texture.setDefaultBufferSize(previewSize.width, previewSize.height)
        val preview = Surface(texture)
        previewSurface = preview

        // Small analysis resolution: this feeds the per-frame face
        // landmarker, not the saved image, so it favors tracking latency
        // over pixel detail. Picking a supported YUV_420_888 size close
        // to 480p, biased toward the smallest available at-or-above that
        // floor, avoids IllegalArgumentException from requesting a size
        // the sensor doesn't actually offer.
        val yuvSizes = map.getOutputSizes(ImageFormat.YUV_420_888)?.toList().orEmpty()
        val analysisSize = pickClosestSize(yuvSizes, targetWidth = 480, targetHeight = 360)
            ?: throw IllegalStateException("No YUV_420_888 output sizes for camera $cameraId")
        val reader = ImageReader.newInstance(analysisSize.width, analysisSize.height, ImageFormat.YUV_420_888, 2)
        reader.setOnImageAvailableListener({ r -> handleAnalysisFrame(r) }, backgroundHandler)
        analysisReader = reader

        val jpegSizes = map.getOutputSizes(ImageFormat.JPEG)?.toList().orEmpty()
        val maxJpeg = jpegSizes.maxByOrNull { it.width.toLong() * it.height } ?: Size(1920, 1080)
        val jpeg = ImageReader.newInstance(maxJpeg.width, maxJpeg.height, ImageFormat.JPEG, 3)
        stillReader = jpeg

        cameraDevice = openCameraDevice(cameraId)
        captureSession = createSession(listOfNotNull(preview, reader.surface, jpeg.surface))
        startRepeatingPreview()
    }

    private suspend fun openCameraDevice(cameraId: String): CameraDevice = suspendCoroutine { cont ->
        try {
            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) = cont.resume(device)
                override fun onDisconnected(device: CameraDevice) {
                    device.close()
                    onError?.invoke("Camera disconnected")
                }
                override fun onError(device: CameraDevice, error: Int) {
                    device.close()
                    cont.resumeWithException(IllegalStateException("Camera open error code $error"))
                }
            }, backgroundHandler)
        } catch (e: SecurityException) {
            cont.resumeWithException(e)
        }
    }

    private suspend fun createSession(surfaces: List<Surface>): CameraCaptureSession = suspendCoroutine { cont ->
        val device = cameraDevice ?: run {
            cont.resumeWithException(IllegalStateException("Camera device not open"))
            return@suspendCoroutine
        }
        val callback = object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(session: CameraCaptureSession) = cont.resume(session)
            override fun onConfigureFailed(session: CameraCaptureSession) =
                cont.resumeWithException(IllegalStateException("Camera session configuration failed"))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val configs = surfaces.map { OutputConfiguration(it) }
            val sessionConfig = SessionConfiguration(
                SessionConfiguration.SESSION_REGULAR,
                configs,
                context.mainExecutor,
                callback,
            )
            device.createCaptureSession(sessionConfig)
        } else {
            @Suppress("DEPRECATION")
            device.createCaptureSession(surfaces, callback, backgroundHandler)
        }
    }

    private fun startRepeatingPreview() {
        val device = cameraDevice ?: return
        val session = captureSession ?: return
        val preview = previewSurface ?: return
        val analysis = analysisReader?.surface ?: return

        val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
            addTarget(preview)
            addTarget(analysis)
            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
            set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            set(CaptureRequest.CONTROL_AE_LOCK, false)
        }
        repeatingRequestBuilder = builder
        session.setRepeatingRequest(builder.build(), null, backgroundHandler)
    }

    private fun handleAnalysisFrame(reader: ImageReader) {
        val image = reader.acquireLatestImage() ?: return
        try {
            val bitmap = yuv420ToBitmap(image)
            val rotated = rotateAndMirror(bitmap, sensorOrientation, isFrontFacing)
            onAnalysisFrame?.invoke(rotated, System.currentTimeMillis())
        } catch (e: Exception) {
            onError?.invoke("Analysis frame conversion failed: ${e.message}")
        } finally {
            image.close()
        }
    }

    /**
     * Real AE lock via CONTROL_AE_LOCK on the live repeating request --
     * unlike the PWA's tryLockCapture, this doesn't need to guess a
     * manual exposureTime and hope the browser accepts it; the sensor
     * just freezes at whatever it last converged to.
     */
    fun setAeLock(locked: Boolean) {
        val builder = repeatingRequestBuilder ?: return
        val session = captureSession ?: return
        builder.set(CaptureRequest.CONTROL_AE_LOCK, locked)
        session.setRepeatingRequest(builder.build(), null, backgroundHandler)
    }

    fun setTorch(on: Boolean): Boolean {
        if (!hasTorch()) return false
        val builder = repeatingRequestBuilder ?: return false
        val session = captureSession ?: return false
        builder.set(CaptureRequest.FLASH_MODE, if (on) CaptureRequest.FLASH_MODE_TORCH else CaptureRequest.FLASH_MODE_OFF)
        session.setRepeatingRequest(builder.build(), null, backgroundHandler)
        return true
    }

    /** Grabs one full-resolution JPEG still, independent of the analysis stream feeding the tracker. */
    suspend fun captureStillJpeg(): ByteArray = suspendCoroutine { cont ->
        val device = cameraDevice
        val session = captureSession
        val reader = stillReader
        if (device == null || session == null || reader == null) {
            cont.resumeWithException(IllegalStateException("Camera not ready for still capture"))
            return@suspendCoroutine
        }

        reader.setOnImageAvailableListener({ r ->
            val image = r.acquireLatestImage()
            if (image == null) {
                cont.resumeWithException(IllegalStateException("No still image available"))
                return@setOnImageAvailableListener
            }
            try {
                val buffer = image.planes[0].buffer
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                cont.resume(bytes)
            } finally {
                image.close()
            }
        }, backgroundHandler)

        val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
            addTarget(reader.surface)
            set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            set(CaptureRequest.CONTROL_AE_LOCK, repeatingRequestBuilder?.get(CaptureRequest.CONTROL_AE_LOCK) ?: false)
            set(CaptureRequest.JPEG_ORIENTATION, jpegOrientation())
        }
        session.capture(builder.build(), object : CameraCaptureSession.CaptureCallback() {
            override fun onCaptureFailed(
                session: CameraCaptureSession,
                request: CaptureRequest,
                failure: android.hardware.camera2.CaptureFailure,
            ) {
                cont.resumeWithException(IllegalStateException("Still capture failed, reason=${failure.reason}"))
            }
        }, backgroundHandler)
    }

    private fun jpegOrientation(): Int {
        // Device is locked portrait (see AndroidManifest); JPEG_ORIENTATION
        // wants the rotation needed to make the image upright relative to
        // the sensor's natural orientation, mirrored for the front camera
        // the same way the display preview is (see MIRRORED in Config.kt).
        val orientation = sensorOrientation
        return if (isFrontFacing) (orientation + 0) % 360 else orientation
    }

    /**
     * Starts the supplementary "Active Sweep" video, mirroring
     * videoRecorder.ts: full camera frame, not cropped, high target
     * bitrate. Uses the still reader's surface's sibling -- a dedicated
     * MediaRecorder input surface added to a *new* session alongside
     * preview+analysis, since the still-JPEG stream isn't needed
     * concurrently with recording.
     */
    suspend fun startVideoRecording(outputFile: File, videoSize: Size, bitrateBps: Int): Boolean {
        val device = cameraDevice ?: return false
        val preview = previewSurface ?: return false
        val analysis = analysisReader?.surface ?: return false

        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        try {
            recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            recorder.setVideoSize(videoSize.width, videoSize.height)
            recorder.setVideoFrameRate(30)
            recorder.setVideoEncodingBitRate(bitrateBps)
            recorder.setOrientationHint(jpegOrientation())
            recorder.setOutputFile(outputFile.absolutePath)
            recorder.prepare()
        } catch (e: Exception) {
            onError?.invoke("Video recorder setup failed: ${e.message}")
            return false
        }

        val surface = recorder.surface
        recorderSurface = surface
        videoOutputFile = outputFile

        return try {
            // Reconfigure the session to add the recorder surface. Preview
            // and analysis keep running unchanged; only the still-JPEG
            // target is dropped for the duration of the recording, since
            // it isn't needed once the anchor stills are already captured.
            captureSession = createSession(listOf(preview, analysis, surface))
            val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                addTarget(preview)
                addTarget(analysis)
                addTarget(surface)
                set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                set(CaptureRequest.CONTROL_AE_LOCK, true)
            }
            repeatingRequestBuilder = builder
            captureSession?.setRepeatingRequest(builder.build(), null, backgroundHandler)
            recorder.start()
            mediaRecorder = recorder
            true
        } catch (e: Exception) {
            onError?.invoke("Video recording start failed: ${e.message}")
            recorder.release()
            mediaRecorder = null
            false
        }
    }

    /** Stops the sweep recording and restores the preview+analysis+still session. */
    suspend fun stopVideoRecording(): File? {
        val recorder = mediaRecorder ?: return null
        val file = videoOutputFile
        try {
            recorder.stop()
        } catch (e: Exception) {
            onError?.invoke("Video recorder stop failed: ${e.message}")
        } finally {
            recorder.release()
            mediaRecorder = null
        }

        val device = cameraDevice
        val preview = previewSurface
        val analysis = analysisReader?.surface
        val jpeg = stillReader?.surface
        if (device != null && preview != null && analysis != null && jpeg != null) {
            try {
                captureSession = createSession(listOfNotNull(preview, analysis, jpeg))
                startRepeatingPreview()
            } catch (e: Exception) {
                onError?.invoke("Failed to restore preview session after recording: ${e.message}")
            }
        }
        return file
    }

    fun close() {
        try {
            mediaRecorder?.let {
                try { it.stop() } catch (_: Exception) {}
                it.release()
            }
        } finally {
            mediaRecorder = null
        }
        captureSession?.close()
        captureSession = null
        cameraDevice?.close()
        cameraDevice = null
        analysisReader?.close()
        analysisReader = null
        stillReader?.close()
        stillReader = null
        previewSurface = null
        repeatingRequestBuilder = null
        characteristics = null
        currentCameraId = null
    }

    fun release() {
        close()
        backgroundThread.quitSafely()
    }

    companion object {
        private fun pickClosestSize(sizes: List<Size>, targetWidth: Int, targetHeight: Int): Size? {
            if (sizes.isEmpty()) return null
            return sizes.minByOrNull { size ->
                val areaDiff = kotlin.math.abs(size.width.toLong() * size.height - targetWidth.toLong() * targetHeight)
                areaDiff
            }
        }

        /**
         * YUV_420_888 -> NV21 -> JPEG -> Bitmap round trip. Not the
         * cheapest possible conversion (a direct RGB decode would avoid
         * the JPEG step), but it only needs to run against the small
         * analysis-resolution stream, and it uses only stable public
         * Android APIs rather than a native YUV shader -- correctness
         * over micro-optimization for a first cut that hasn't been
         * profiled on a real device yet.
         */
        fun yuv420ToBitmap(image: Image): Bitmap {
            val nv21 = yuv420ToNv21(image)
            val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
            val out = ByteArrayOutputStream()
            yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 90, out)
            val jpegBytes = out.toByteArray()
            return android.graphics.BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
        }

        private fun yuv420ToNv21(image: Image): ByteArray {
            val width = image.width
            val height = image.height
            val ySize = width * height
            val nv21 = ByteArray(ySize + width * height / 2)

            val yPlane = image.planes[0]
            val uPlane = image.planes[1]
            val vPlane = image.planes[2]

            var pos = 0
            val yBuffer = yPlane.buffer
            val yRowStride = yPlane.rowStride
            val yPixelStride = yPlane.pixelStride
            for (row in 0 until height) {
                var col = 0
                val rowStart = row * yRowStride
                while (col < width) {
                    nv21[pos++] = yBuffer.get(rowStart + col * yPixelStride)
                    col++
                }
            }

            val uBuffer = uPlane.buffer
            val vBuffer = vPlane.buffer
            val uRowStride = uPlane.rowStride
            val uPixelStride = uPlane.pixelStride
            val vRowStride = vPlane.rowStride
            val vPixelStride = vPlane.pixelStride
            val chromaHeight = height / 2
            val chromaWidth = width / 2
            for (row in 0 until chromaHeight) {
                var col = 0
                val uRowStart = row * uRowStride
                val vRowStart = row * vRowStride
                while (col < chromaWidth) {
                    // NV21 interleaves V then U per 2x2 luma block.
                    nv21[pos++] = vBuffer.get(vRowStart + col * vPixelStride)
                    nv21[pos++] = uBuffer.get(uRowStart + col * uPixelStride)
                    col++
                }
            }

            return nv21
        }

        fun rotateAndMirror(bitmap: Bitmap, degrees: Int, mirror: Boolean): Bitmap {
            val matrix = Matrix()
            if (mirror) matrix.postScale(-1f, 1f)
            matrix.postRotate(degrees.toFloat())
            return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        }
    }
}
