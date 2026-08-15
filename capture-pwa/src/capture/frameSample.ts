/**
 * Downscaled ImageData snapshot of the live video, used for card
 * detection + light estimation. Deliberately not full track resolution
 * (unlike the burst-frame capture path in frameScore.ts): ArUco
 * detection runs on every throttled tracking tick while the viewfinder
 * is live, so it needs to stay cheap, and marker/highlight detection
 * doesn't need 4K pixels to work.
 */
export function sampleVideoFrame(video: HTMLVideoElement, maxWidth: number): ImageData | null {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
