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

export async function captureAndScoreFrame(
  video: HTMLVideoElement,
  width: number,
  height: number,
  overlayLines?: string[],
): Promise<ScoredFrame> {
  const fullRes = new OffscreenCanvas(width, height);
  const fullCtx = fullRes.getContext('2d')!;
  fullCtx.drawImage(video, 0, 0, width, height);

  const scoreWidth = 160;
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
 * Burns the live debug readout (same numbers /debug.html shows) into
 * the bottom of the saved image, so each photo carries the pose data it
 * was captured at.
 */
function drawOverlayBar(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  lines: string[],
): void {
  const lineHeight = Math.max(20, Math.round(height * 0.022));
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
