const SAMPLE_SIZE = 24;

/**
 * Gate 7 (exposure) needs the fraction of clipped pixels inside the
 * mouth box. That requires reading pixel data, a DOM/canvas concern, so
 * it lives in the UI layer and gets passed into the pure gate evaluator
 * as a plain number (see gates/types.ts FrameInputs).
 */
export function sampleClippedFraction(
  video: HTMLVideoElement,
  box: { x: number; y: number; w: number; h: number } | null,
  scratch: CanvasRenderingContext2D,
): number {
  if (!box || video.videoWidth === 0) return 0;

  scratch.canvas.width = SAMPLE_SIZE;
  scratch.canvas.height = SAMPLE_SIZE;

  const sx = Math.max(0, box.x * video.videoWidth);
  const sy = Math.max(0, box.y * video.videoHeight);
  const sw = Math.min(video.videoWidth - sx, box.w * video.videoWidth);
  const sh = Math.min(video.videoHeight - sy, box.h * video.videoHeight);
  if (sw <= 0 || sh <= 0) return 0;

  scratch.drawImage(video, sx, sy, sw, sh, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = scratch.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  let clipped = 0;
  const total = SAMPLE_SIZE * SAMPLE_SIZE;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 250 || data[i + 1] > 250 || data[i + 2] > 250) clipped++;
  }
  return clipped / total;
}
