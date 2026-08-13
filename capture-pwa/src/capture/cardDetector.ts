import { CARD_CONFIG } from '../config';

/**
 * js-aruco2 is a legacy global-scope library (top-level `this.AR = AR`,
 * `this.CV = CV`), written to run as a plain `<script>` tag where `this`
 * is `window`. Bundling its source through Vite/Rollup's CommonJS
 * interop was verified to build without error but silently break at
 * runtime: the interop wrapper calls the module factory without binding
 * `this` to the module's exports the way Node's real CJS wrapper does,
 * so `this.AR = AR` sets a property on `undefined`/the global object
 * instead, and the imported `AR` binding comes back undefined. Loading
 * the vendored copy (public/vendor/js-aruco2/, precached by the service
 * worker the same way the model/wasm assets are) as real script tags
 * sidesteps the interop entirely and matches how the library expects to
 * run. Load order matters: cv.js sets window.CV (which aruco.js reads),
 * aruco.js sets window.AR (which the dictionary file reads to register
 * itself into AR.DICTIONARIES).
 */
interface ArucoMarker {
  id: number;
  corners: { x: number; y: number }[];
}

interface ArucoDetector {
  detect(imageData: ImageData): ArucoMarker[];
}

declare global {
  interface Window {
    AR?: {
      Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => ArucoDetector;
      DICTIONARIES: Record<string, unknown>;
    };
  }
}

const BASE = import.meta.env.BASE_URL;
const VENDOR_BASE = `${BASE}vendor/js-aruco2`;

let loadPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Kicks off loading the vendored ArUco scripts. Safe to call multiple
 * times (memoized) and safe to not await: detectCard() below no-ops
 * until window.AR exists, so callers can fire this once at startup and
 * not block camera/tracker init on it.
 */
export function initCardDetector(): Promise<void> {
  if (!loadPromise) {
    loadPromise = loadScript(`${VENDOR_BASE}/cv.js`)
      .then(() => loadScript(`${VENDOR_BASE}/aruco.js`))
      .then(() => loadScript(`${VENDOR_BASE}/dictionaries/aruco_mip_36h12.js`));
  }
  return loadPromise;
}

export interface CardDetectionResult {
  markersDetected: number[];
  allMarkersVisible: boolean;
  /**
   * One entry per CARD_CONFIG.expectedMarkerIds, in that order, center
   * point of the marker in pixel space, or null if that marker wasn't
   * seen this frame.
   */
  cornerPoints: ({ x: number; y: number } | null)[];
  /**
   * Ratio deviation between the quad's two diagonals (0 = perfectly
   * square-on). Null when fewer than 4 corners are available to form
   * a quad.
   */
  diagonalRatioDeviation: number | null;
  isFlat: boolean;
}

const NOT_DETECTED: CardDetectionResult = {
  markersDetected: [],
  allMarkersVisible: false,
  cornerPoints: CARD_CONFIG.expectedMarkerIds.map(() => null),
  diagonalRatioDeviation: null,
  isFlat: false,
};

let detector: ArucoDetector | null = null;

function getDetector(): ArucoDetector | null {
  if (!window.AR) return null;
  if (!detector) {
    detector = new window.AR.Detector({
      dictionaryName: CARD_CONFIG.dictionaryName,
      maxHammingDistance: CARD_CONFIG.maxHammingDistance,
    });
  }
  return detector;
}

function markerCenter(corners: { x: number; y: number }[]): { x: number; y: number } {
  const sum = corners.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), { x: 0, y: 0 });
  return { x: sum.x / corners.length, y: sum.y / corners.length };
}

/**
 * Detects the calibration card's ArUco markers in a single frame.
 *
 * PLACEHOLDER assumption pending the real card's physical layout: the
 * four entries of CARD_CONFIG.expectedMarkerIds are assumed to map, in
 * order, to the card's top-left / top-right / bottom-right / bottom-left
 * corners, matching how the diagonal-ratio flatness check pairs them
 * (0<->2, 1<->3). Replace this mapping once the real card design is
 * known -- "off the shelf now, replace if inadequate".
 */
export function detectCard(imageData: ImageData): CardDetectionResult {
  const activeDetector = getDetector();
  if (!activeDetector) return NOT_DETECTED;

  const markers = activeDetector.detect(imageData);
  if (markers.length === 0) return NOT_DETECTED;

  const byId = new Map(markers.map((m) => [m.id, m]));
  const markersDetected = markers.map((m) => m.id);

  const cornerPoints = CARD_CONFIG.expectedMarkerIds.map((id) => {
    const marker = byId.get(id);
    return marker ? markerCenter(marker.corners) : null;
  });

  const allMarkersVisible = cornerPoints.every((p) => p !== null);

  const diagonalRatioDeviation = allMarkersVisible
    ? computeDiagonalRatioDeviation(cornerPoints as { x: number; y: number }[])
    : null;

  const isFlat =
    diagonalRatioDeviation !== null &&
    diagonalRatioDeviation <= CARD_CONFIG.maxDiagonalRatioDeviation;

  return {
    markersDetected,
    allMarkersVisible,
    cornerPoints,
    diagonalRatioDeviation,
    isFlat,
  };
}

/**
 * Compares the two diagonals of the quad formed by corners [TL, TR, BR,
 * BL] (index order, see mapping note above). A card held flat and
 * square to the camera has near-equal diagonals; foreshortening from
 * tilting the card skews one diagonal shorter than the other.
 */
function computeDiagonalRatioDeviation(corners: { x: number; y: number }[]): number {
  const [tl, tr, br, bl] = corners;
  const diag1 = Math.hypot(br.x - tl.x, br.y - tl.y);
  const diag2 = Math.hypot(bl.x - tr.x, bl.y - tr.y);
  const longer = Math.max(diag1, diag2);
  const shorter = Math.min(diag1, diag2);
  if (longer === 0) return 0;
  return 1 - shorter / longer;
}
