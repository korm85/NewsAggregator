import { CARD_CONFIG } from '../config';

export interface LightEstimate {
  /**
   * Lateral offset of the specular highlight from the reference patch's
   * expected center, normalized so 1.0 = one patch radius. Not a solved
   * 3D light vector, just a 2D proxy: the highlight sits closer to
   * whichever side the light is coming from. Good enough to flag "light
   * is coming from the left/above" without a photometric-stereo rig.
   * See module doc below.
   */
  direction2D: { x: number; y: number };
  /** Pixel position of the detected highlight, in the source ImageData's coordinate space. */
  highlightPosition: { x: number; y: number };
}

/**
 * Off-the-shelf light-direction heuristic, not a rigorous photometric
 * solve (per "let's have the off the shelf implemented now, if will not
 * be good or redundant we will replace it"). A proper estimate would
 * need the reference patch's known 3D surface normal plus the camera's
 * view vector at that point and would solve a reflection equation; we
 * don't have a calibrated rig for that here. Instead: find the
 * brightest little cluster inside the expected reference-patch region
 * and report how far off-center it sits. A highlight offset toward one
 * side of the patch means the light source leans toward that side --
 * a coarse but honest signal, unlike a fixed-normal reflection formula
 * that would return the same answer regardless of where the highlight
 * actually falls.
 */
export function estimateLightDirection(
  imageData: ImageData,
  cardCorners: { x: number; y: number }[],
): LightEstimate | null {
  if (cardCorners.length !== 4 || cardCorners.some((c) => c === null)) return null;

  const [tl, tr, br, bl] = cardCorners;
  const { x: u, y: v, radiusFraction } = CARD_CONFIG.lightReferencePatch;

  // Bilinear interpolation of the reference patch's expected center
  // within the quad spanned by the four corner markers (TL/TR/BR/BL,
  // see cardDetector.ts's corner-mapping caveat).
  const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
  const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
  const expectedCenter = { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };

  const quadWidth = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const searchRadius = Math.max(4, quadWidth * radiusFraction);

  const highlightPosition = findBrightestSpot(imageData, expectedCenter, searchRadius);
  if (!highlightPosition) return null;

  const direction2D = {
    x: (highlightPosition.x - expectedCenter.x) / searchRadius,
    y: (highlightPosition.y - expectedCenter.y) / searchRadius,
  };

  return { direction2D, highlightPosition };
}

/** Scans a square window around `center` for the brightest single pixel. */
function findBrightestSpot(
  imageData: ImageData,
  center: { x: number; y: number },
  radius: number,
): { x: number; y: number } | null {
  const { data, width, height } = imageData;
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(height - 1, Math.ceil(center.y + radius));

  let bestBrightness = -1;
  let best: { x: number; y: number } | null = null;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = (y * width + x) * 4;
      const brightness = data[idx] + data[idx + 1] + data[idx + 2];
      if (brightness > bestBrightness) {
        bestBrightness = brightness;
        best = { x, y };
      }
    }
  }

  return best;
}
