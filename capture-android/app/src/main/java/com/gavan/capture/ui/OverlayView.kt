package com.gavan.capture.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import com.gavan.capture.gates.ArrowDirection
import com.gavan.capture.gates.FrameColor
import com.gavan.capture.tracker.MouthBox

/**
 * Canvas counterpart to capture-pwa/src/ui/overlay.ts: draws the mouth
 * bounding box (color-coded by gate pass/fail), a direction arrow, and
 * the hold-progress ring. The countdown numeral is a separate DOM/View
 * element (see activity_viewfinder.xml's countdown_numeral TextView),
 * matching the PWA's own reasoning for keeping it off-canvas -- it's a
 * fixed, screen-centered element with no landmark coordinates to track,
 * and (for the front camera) needs to read right-side-up rather than
 * inherit this view's mirrored transform.
 */
class OverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    var mouthBox: MouthBox? = null
    var frameColor: FrameColor = FrameColor.NONE
    var arrowDirection: ArrowDirection? = null
    var ringProgress: Float = 0f

    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 6f
    }
    private val arrowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.WHITE
    }
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 8f
        strokeCap = Paint.Cap.ROUND
        color = Color.parseColor("#22C55E")
    }

    fun update(mouthBox: MouthBox?, frameColor: FrameColor, arrowDirection: ArrowDirection?, ringProgress: Float) {
        this.mouthBox = mouthBox
        this.frameColor = frameColor
        this.arrowDirection = arrowDirection
        this.ringProgress = ringProgress
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val box = mouthBox
        boxPaint.color = when (frameColor) {
            FrameColor.GREEN -> Color.parseColor("#22C55E")
            FrameColor.AMBER -> Color.parseColor("#F59E0B")
            FrameColor.NONE -> Color.parseColor("#64748B")
        }

        if (box != null) {
            val rect = RectF(
                (box.x * width).toFloat(),
                (box.y * height).toFloat(),
                ((box.x + box.w) * width).toFloat(),
                ((box.y + box.h) * height).toFloat(),
            )
            canvas.drawRoundRect(rect, 16f, 16f, boxPaint)

            if (ringProgress > 0f) {
                val ringRect = RectF(rect)
                ringRect.inset(-20f, -20f)
                canvas.drawArc(ringRect, -90f, 360f * ringProgress, false, ringPaint)
            }
        }

        arrowDirection?.let { drawArrow(canvas, it) }
    }

    private fun drawArrow(canvas: Canvas, direction: ArrowDirection) {
        val cx = width / 2f
        val cy = height / 2f
        val size = 60f
        val path = android.graphics.Path()
        when (direction) {
            ArrowDirection.LEFT -> {
                path.moveTo(cx - size, cy)
                path.lineTo(cx, cy - size / 2)
                path.lineTo(cx, cy + size / 2)
            }
            ArrowDirection.RIGHT -> {
                path.moveTo(cx + size, cy)
                path.lineTo(cx, cy - size / 2)
                path.lineTo(cx, cy + size / 2)
            }
            ArrowDirection.UP -> {
                path.moveTo(cx, cy - size)
                path.lineTo(cx - size / 2, cy)
                path.lineTo(cx + size / 2, cy)
            }
            ArrowDirection.DOWN -> {
                path.moveTo(cx, cy + size)
                path.lineTo(cx - size / 2, cy)
                path.lineTo(cx + size / 2, cy)
            }
        }
        path.close()
        canvas.drawPath(path, arrowPaint)
    }
}
