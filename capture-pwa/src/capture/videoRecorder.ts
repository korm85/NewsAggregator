/**
 * Records a real video clip alongside the raw-frame still-image burst,
 * per the Smart Frame spec's "automatic initiation of video recording
 * ... a five-second video to manage reflections". Purely supplementary:
 * the still image (captureSequence.ts, scored raw canvas frames) stays
 * the source of truth for color/shade measurement, never this. Encoded
 * video is lossy (handoff Section 2 decision 3's original reasoning for
 * why measurement frames are never sourced from encoded video still
 * applies), so this exists for reflection/lighting-context review, not
 * calibration.
 *
 * Records the raw camera track directly (full frame, not cropped to
 * the mouth like the still image): cropping would mean continuously
 * redrawing the live frame to a canvas for the full 5 seconds to feed
 * MediaRecorder, a real per-frame cost stacked on top of the tracker
 * and gate evaluator already running every frame. Recording the track
 * directly has none of that, the browser's own camera pipeline feeds
 * the encoder. The gallery visually crops the full-frame video via CSS
 * to look consistent with the still image (src/ui/galleryScreen.ts).
 */
const CANDIDATE_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export interface RecordedVideo {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface VideoRecording {
  stop(): Promise<RecordedVideo>;
}

/**
 * Returns null when MediaRecorder/no supported mimeType is available,
 * or if starting the recorder throws for any reason. A failure here
 * must never break the still-image capture path, video is purely
 * supplementary, so every failure mode degrades to "no video" rather
 * than propagating.
 */
export function startVideoRecording(track: MediaStreamTrack): VideoRecording | null {
  const mimeType = pickSupportedMimeType();
  if (!mimeType) return null;

  try {
    const stream = new MediaStream([track]);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    const startedAt = performance.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.start();

    return {
      stop(): Promise<RecordedVideo> {
        return new Promise((resolve, reject) => {
          recorder.onstop = () => {
            resolve({
              blob: new Blob(chunks, { type: mimeType }),
              mimeType,
              durationMs: performance.now() - startedAt,
            });
          };
          recorder.onerror = () => reject(new Error('MediaRecorder error'));
          try {
            recorder.stop();
          } catch (err) {
            reject(err);
          }
        });
      },
    };
  } catch {
    return null;
  }
}
