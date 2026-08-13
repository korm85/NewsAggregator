export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Normalized (0-1) card guide region anchored below the mouth box.
 * Placeholder sizing (2.5x mouth width, 22% of frame height) pending
 * real card dimensions. Single source of truth shared by the Smart
 * Frame overlay drawing (src/ui/overlay.ts, dashed guide rectangle) and
 * the capture crop (src/capture/captureSequence.ts): the saved image
 * needs to actually include this region when cardboardMode is on, not
 * just the mouth box, or the card the clinician was guided to hold
 * there never ends up in the photo.
 */
export function computeCardGuideRect(mouthBox: NormalizedRect): NormalizedRect {
  const widthFrac = Math.min(0.85, mouthBox.w * 2.5);
  const heightFrac = 0.22;
  const centerX = mouthBox.x + mouthBox.w / 2;
  const x = Math.max(0, Math.min(1 - widthFrac, centerX - widthFrac / 2));
  const y = Math.min(1 - heightFrac, mouthBox.y + mouthBox.h + 0.03);
  return { x, y, w: widthFrac, h: heightFrac };
}

/** Smallest rect containing both inputs. Normalized (0-1) coordinates. */
export function unionRect(a: NormalizedRect, b: NormalizedRect): NormalizedRect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
