package com.gavan.capture.capture

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlin.math.min

/**
 * Cheap sharpness-minus-clipping score for picking the best of the still
 * candidates, mirroring the intent of capture-pwa/src/capture/frameScore.ts
 * (that file scores canvas ImageData directly; this scores decoded JPEG
 * bytes since Camera2's still stream is JPEG, not raw canvas pixels).
 * Downsampled before scoring -- this only needs to rank three near-
 * identical frames against each other, not analyze full resolution.
 */
object FrameScore {
    private const val MAX_DIMENSION = 320

    fun score(jpegBytes: ByteArray): Double {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size, opts)
        val sampleSize = calculateSampleSize(opts.outWidth, opts.outHeight, MAX_DIMENSION)

        val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        val bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size, decodeOpts) ?: return 0.0
        return try {
            score(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    private fun score(bitmap: Bitmap): Double {
        val width = bitmap.width
        val height = bitmap.height
        if (width < 3 || height < 3) return 0.0

        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        fun luma(argb: Int): Double {
            val r = (argb shr 16) and 0xFF
            val g = (argb shr 8) and 0xFF
            val b = argb and 0xFF
            return 0.299 * r + 0.587 * g + 0.114 * b
        }

        var sharpnessSum = 0.0
        var clippedCount = 0
        var count = 0

        for (y in 1 until height - 1) {
            val rowOffset = y * width
            for (x in 1 until width - 1) {
                val center = luma(pixels[rowOffset + x])
                // Simple discrete Laplacian: 4*center - neighbors.
                val laplacian = 4 * center -
                    luma(pixels[rowOffset + x - 1]) -
                    luma(pixels[rowOffset + x + 1]) -
                    luma(pixels[rowOffset - width + x]) -
                    luma(pixels[rowOffset + width + x])
                sharpnessSum += laplacian * laplacian
                if (center > 250) clippedCount++
                count++
            }
        }

        val sharpness = if (count > 0) sharpnessSum / count else 0.0
        val clippingPenalty = if (count > 0) (clippedCount.toDouble() / count) * sharpness * 0.5 else 0.0
        return sharpness - clippingPenalty
    }

    private fun calculateSampleSize(width: Int, height: Int, maxDimension: Int): Int {
        var sample = 1
        while (width / sample > maxDimension * 2 || height / sample > maxDimension * 2) {
            sample *= 2
        }
        return min(sample, 8)
    }
}
