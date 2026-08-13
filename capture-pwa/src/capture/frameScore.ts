/**
 * Handoff Section 9 step 5: score each burst frame by sharpness and
 * clipping, keep the best. Sharpness is approximated with a Laplacian
 * variance over a small downsampled grayscale copy (cheap); clipping is
 * the fraction of pixels with any channel above 250. Scoring never
 * touches the full-resolution pixels, only the frame that gets encoded
 * to JPEG is full-res, matching "captured stills are full track
 * resolution" while keeping the per-frame scoring cost small.
 */
export interface ScoredFrame {
  blob: Blob;
  score: number;
  clippedFraction: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * `crop` is a pixel-space rect on the raw video track (the mouth
 * bounding box, at capture time), so the saved image is just the
 * silhouette region, not the whole frame. Still drawn straight from the
 * live video element at native pixel density within that region, never
 * from an encoded/re-scaled source.
 */
export async function captureAndScoreFrame(
  video: HTMLVideoElement,
  crop: CropRect,
  overlayLines?: string[],
): Promise<ScoredFrame> {
  const width = Math.max(1, Math.round(crop.w));
  const height = Math.max(1, Math.round(crop.h));

  const fullRes = new OffscreenCanvas(width, height);
  const fullCtx = fullRes.getContext('2d')!;
  fullCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);

  const scoreWidth = Math.min(160, width);
  const scoreHeight = Math.max(1, Math.round((scoreWidth * height) / width));
  const scoreCanvas = new OffscreenCanvas(scoreWidth, scoreHeight);
  const scoreCtx = scoreCanvas.getContext('2d')!;
  scoreCtx.drawImage(fullRes, 0, 0, scoreWidth, scoreHeight);
  const { data } = scoreCtx.getImageData(0, 0, scoreWidth, scoreHeight);

  let clipped = 0;
  const gray = new Float32Array(scoreWidth * scoreHeight);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 250 || g > 250 || b > 250) clipped++;
    gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const clippedFraction = clipped / (scoreWidth * scoreHeight);

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < scoreHeight - 1; y++) {
    for (let x = 1; x < scoreWidth - 1; x++) {
      const idx = y * scoreWidth + x;
      const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - scoreWidth] - gray[idx + scoreWidth];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = n > 0 ? sum / n : 0;
  const variance = n > 0 ? sumSq / n - mean * mean : 0;
  const score = variance * (1 - clippedFraction);

  // Burned in after scoring so the overlay pixels never skew the
  // sharpness/clipping measurement above.
  if (overlayLines && overlayLines.length > 0) {
    drawOverlayBar(fullCtx, width, height, overlayLines);
  }

  const blob = await fullRes.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return { blob, score, clippedFraction };
}

/**
 * Crops a source image (e.g. a high-res ImageCapture photo, which has
 * its own native dimensions distinct from the live video stream's) to
 * a normalized (0-1) region and burns the overlay bar into it, so an
 * ImageCapture-sourced still ends up cropped to the same mouth region
 * as a canvas-sourced one instead of showing the full frame -- keeping
 * capture output consistent regardless of which pipeline produced it
 * (see imageCapture.ts).
 */
export async function cropAndOverlayBlob(
  sourceBlob: Blob,
  region: { x: number; y: number; w: number; h: number },
  overlayLines?: string[],
): Promise<Blob> {
  const bitmap = await createImageBitmap(sourceBlob);
  const rawX = region.x * bitmap.width;
  const rawY = region.y * bitmap.height;
  const rawW = region.w * bitmap.width;
  const rawH = region.h * bitmap.height;
  const x1 = Math.max(0, rawX);
  const y1 = Math.max(0, rawY);
  const x2 = Math.min(bitmap.width, rawX + rawW);
  const y2 = Math.min(bitmap.height, rawY + rawH);
  const width = Math.max(1, Math.round(x2 - x1));
  const height = Math.max(1, Math.round(y2 - y1));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, x1, y1, x2 - x1, y2 - y1, 0, 0, width, height);
  bitmap.close();

  if (overlayLines && overlayLines.length > 0) {
    drawOverlayBar(ctx, width, height, overlayLines);
  }

  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

/**
 * Burns the live debug readout (same numbers /debug.html shows) into
 * the bottom of the saved image, so each photo carries the pose data it
 * was captured at. Crops are small (a mouth region, not a full frame),
 * so the line height floor is lower than a full-frame bar would need.
 */
function drawOverlayBar(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  lines: string[],
): void {
  const lineHeight = Math.max(14, Math.round(height * 0.05));
  const padding = Math.round(lineHeight * 0.6);
  const barHeight = lines.length * lineHeight + padding * 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, height - barHeight, width, barHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = `${lineHeight - 4}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.fillText(line, padding, height - barHeight + padding + i * lineHeight);
  });
}
