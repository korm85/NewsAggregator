/**
 * Optional higher-quality still capture via the browser's ImageCapture
 * API, which can access the camera's dedicated photo pipeline (often a
 * higher resolution than the live video stream negotiates) rather than
 * grabbing a frame off the video track. Chrome/Android only — Safari/
 * iOS has never implemented it. TypeScript's lib.dom.d.ts support for
 * ImageCapture is historically incomplete/inconsistent across
 * versions, so this hand-rolled interface follows the same pattern
 * deviceCamera.ts already uses for TorchCapabilities/
 * ManualCaptureCapabilities.
 *
 * Every failure mode (unsupported, permission quirk, device rejects
 * the call despite advertising support) degrades to null so the caller
 * can fall back to the existing canvas-frame capture path
 * (frameScore.ts) exactly as before. Never assume support beyond the
 * feature-detect; catch broadly.
 */
interface ImageCaptureLike {
  getPhotoCapabilities(): Promise<{ imageWidth?: { max: number }; imageHeight?: { max: number } }>;
  takePhoto(settings?: { imageWidth?: number; imageHeight?: number }): Promise<Blob>;
}

interface ImageCaptureConstructor {
  new (track: MediaStreamTrack): ImageCaptureLike;
}

export function isImageCaptureSupported(): boolean {
  return 'ImageCapture' in window;
}

export async function takeHighResPhoto(track: MediaStreamTrack): Promise<Blob | null> {
  if (!isImageCaptureSupported()) return null;
  try {
    const Ctor = (window as unknown as { ImageCapture: ImageCaptureConstructor }).ImageCapture;
    const capture = new Ctor(track);
    const capabilities = await capture.getPhotoCapabilities();
    return await capture.takePhoto({
      imageWidth: capabilities.imageWidth?.max,
      imageHeight: capabilities.imageHeight?.max,
    });
  } catch {
    return null;
  }
}
