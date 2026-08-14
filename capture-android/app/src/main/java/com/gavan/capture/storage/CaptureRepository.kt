package com.gavan.capture.storage

import android.content.Context
import com.gavan.capture.capture.CaptureResult
import java.io.File
import java.util.UUID

data class StoredCapture(
    val id: String,
    val bestStillPath: String,
    val stillPaths: List<String>,
    val stillScores: List<Double>,
    val bestStillIndex: Int,
    val offAxisDeg: Double,
    val rollDeg: Double,
    val pitchDeg: Double,
    val yawDeg: Double,
    val mar: Double,
    val smileWidthRatio: Double,
    val mouthBoxWidth: Double,
    val mouthBoxHeight: Double,
    val exposureLockSuccess: Boolean,
    val captureMode: String,
    val capturedAt: String,
    val videoPath: String?,
    val videoDurationMs: Long?,
)

/**
 * App-private storage only -- same "nothing leaves the device" property
 * as capture-pwa/src/storage/captureStore.ts's IndexedDB store. Files
 * live under getExternalFilesDir (no storage permission needed at any
 * API level, but still a real filesystem a user can browse via USB/
 * a file manager for inspection, unlike IndexedDB blobs).
 */
class CaptureRepository(private val context: Context) {
    private val dao = CaptureDatabase.get(context).captureDao()

    private val galleryDir: File
        get() = File(context.getExternalFilesDir(null), "captures").apply { mkdirs() }

    suspend fun save(result: CaptureResult, cardboardMode: Boolean): StoredCapture {
        val id = "${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}"
        val destDir = File(galleryDir, id).apply { mkdirs() }

        val movedStills = result.stillCandidates.mapIndexed { i, candidate ->
            val dest = File(destDir, "still_$i.jpg")
            candidate.file.copyTo(dest, overwrite = true)
            dest
        }
        result.stillCandidates.forEach { it.file.delete() }
        result.stillCandidates.firstOrNull()?.file?.parentFile?.let { if (it.exists() && it.list()?.isEmpty() == true) it.delete() }

        val movedVideo = result.videoFile?.let { video ->
            val dest = File(destDir, "sweep.mp4")
            video.copyTo(dest, overwrite = true)
            video.delete()
            dest
        }

        val entity = CaptureEntity(
            id = id,
            bestStillPath = movedStills[result.bestStillIndex].absolutePath,
            stillPaths = movedStills.joinToString(",") { it.absolutePath },
            stillScores = result.stillCandidates.joinToString(",") { it.score.toString() },
            bestStillIndex = result.bestStillIndex,
            offAxisDeg = result.snapshot.offAxisDeg,
            offAxisVecX = result.snapshot.offAxisVec.x,
            offAxisVecY = result.snapshot.offAxisVec.y,
            rollDeg = result.snapshot.rollDeg,
            pitchDeg = result.snapshot.pitchDeg,
            yawDeg = result.snapshot.yawDeg,
            mar = result.snapshot.mar,
            smileWidthRatio = result.snapshot.smileWidthRatio,
            mouthBoxWidth = result.snapshot.mouthBox?.w ?: 0.0,
            mouthBoxHeight = result.snapshot.mouthBox?.h ?: 0.0,
            exposureLockSuccess = result.exposureLockSuccess,
            captureMode = result.captureMode,
            capturedAt = result.capturedAt,
            cardboardMode = cardboardMode,
            cardMarkersDetected = "",
            cardAllMarkersVisible = false,
            cardIsFlat = false,
            lightDirectionX = null,
            lightDirectionY = null,
            videoPath = movedVideo?.absolutePath,
            videoDurationMs = result.videoDurationMs,
        )
        dao.insert(entity)
        return toStored(entity)
    }

    suspend fun list(): List<StoredCapture> = dao.listAll().map(::toStored)

    suspend fun delete(id: String) {
        dao.listAll().firstOrNull { it.id == id }?.let { entity ->
            (entity.stillPaths.split(",") + listOfNotNull(entity.videoPath)).forEach { File(it).delete() }
            File(entity.bestStillPath).parentFile?.delete()
        }
        dao.deleteById(id)
    }

    suspend fun clear() {
        dao.listAll().forEach { entity ->
            (entity.stillPaths.split(",") + listOfNotNull(entity.videoPath)).forEach { File(it).delete() }
            File(entity.bestStillPath).parentFile?.delete()
        }
        dao.clear()
    }

    private fun toStored(entity: CaptureEntity) = StoredCapture(
        id = entity.id,
        bestStillPath = entity.bestStillPath,
        stillPaths = entity.stillPaths.split(","),
        stillScores = entity.stillScores.split(",").mapNotNull { it.toDoubleOrNull() },
        bestStillIndex = entity.bestStillIndex,
        offAxisDeg = entity.offAxisDeg,
        rollDeg = entity.rollDeg,
        pitchDeg = entity.pitchDeg,
        yawDeg = entity.yawDeg,
        mar = entity.mar,
        smileWidthRatio = entity.smileWidthRatio,
        mouthBoxWidth = entity.mouthBoxWidth,
        mouthBoxHeight = entity.mouthBoxHeight,
        exposureLockSuccess = entity.exposureLockSuccess,
        captureMode = entity.captureMode,
        capturedAt = entity.capturedAt,
        videoPath = entity.videoPath,
        videoDurationMs = entity.videoDurationMs,
    )
}
