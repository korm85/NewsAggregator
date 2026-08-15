package com.gavan.capture.storage

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * On-device capture metadata, mirroring capture-pwa/src/storage/captureStore.ts's
 * IndexedDB record. Image/video bytes live as files under the app's
 * private external storage (see CaptureRepository); this row only stores
 * paths + metadata, same "nothing leaves the device" property the PWA's
 * IndexedDB store has.
 */
@Entity(tableName = "captures")
data class CaptureEntity(
    @PrimaryKey val id: String,
    val bestStillPath: String,
    /** Comma-joined file paths, in capture order, including the one that became bestStillPath. */
    val stillPaths: String,
    /** Comma-joined scores, same order as stillPaths. */
    val stillScores: String,
    val bestStillIndex: Int,
    val offAxisDeg: Double,
    val offAxisVecX: Double,
    val offAxisVecY: Double,
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
    val cardboardMode: Boolean,
    /** Known gap: ArUco card detection isn't ported yet (see README), so these stay at their "off" defaults for now. */
    val cardMarkersDetected: String,
    val cardAllMarkersVisible: Boolean,
    val cardIsFlat: Boolean,
    val lightDirectionX: Double?,
    val lightDirectionY: Double?,
    val videoPath: String?,
    val videoDurationMs: Long?,
)
