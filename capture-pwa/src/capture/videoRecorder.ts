import { TARGET_VIDEO_BITRATE_BPS } from '../config';

/**
 * Records a real video clip across the Active Sweep window, per the
 * Smart Frame spec's "automatic initiation of video recording ... a
 * five-second video to manage reflections". This is now the PRIMARY
 * color-calibration artifact (see captureSequence.ts): the offline
 * post-processor extracts angular telemetry and removes glare from the
 * multiple reflection angles the sweep captures, more accurately than
 * the live browser tracker could. The still image is a single
 * uncompressed anchor frame, not a competing source of truth. Recorded
 * at as high a bitrate as `MediaRecorder` will take (`videoBitsPerSecond`,
 * see config.ts) to minimize compression artifacts in the specular-
 * highlight detail the glare-removal step depends on; no clipping or
 * glare rejection is applied client-side, every highlight is passed
 * through unmodified.
 *
 * Records the raw camera track directly (full frame, not cropped to
 * the mouth like the still image): cropping would mean continuously
 * redrawing the live frame to a canvas for the full 5 seconds to feed
 * MediaRecorder, a real per-frame cost stacked on top of the tracker
 * and gate evaluator already running every frame. Recording the track
 * directly has none of that, the browser's own camera pipeline feeds
 * the encoder. The gallery shows the full-frame video as-is
 * (src/ui/galleryScreen.ts), no crop simulation.
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
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: TARGET_VIDEO_BITRATE_BPS,
    });
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
