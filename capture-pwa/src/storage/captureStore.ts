/**
 * On-device persistence for captured shots (IndexedDB). Nothing here
 * ever leaves the browser: no upload, no server. This is the "data
 * saving" layer v2 adds on top of v1, which deliberately kept nothing
 * beyond the current in-memory result.
 */
const DB_NAME = 'gavan-capture-store';
const DB_VERSION = 1;
const STORE_NAME = 'captures';

export interface StoredCapture {
  id: string;
  /** The auto-picked best of stillCandidates below (highest sharpness/clipping score). Used everywhere a single image is needed: thumbnail, main lightbox view, download. */
  blob: Blob;
  /**
   * All still candidates grabbed at the trigger instant (see
   * captureSequence.ts, CAPTURE_SEQUENCE.stillFrameCount), in capture
   * order, kept alongside `blob` rather than discarded -- insurance
   * against the auto-pick being wrong for a given capture. Includes the
   * one that became `blob`. `bestStillIndex` marks which.
   */
  stillCandidates: Blob[];
  stillScores: number[];
  bestStillIndex: number;
  offAxisDeg: number;
  offAxisVec: { x: number; y: number };
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  mar: number;
  smileWidthRatio: number;
  mouthBoxWidth: number;
  mouthBoxHeight: number;
  exposureLockSuccess: boolean;
  captureMode: 'front' | 'rear';
  capturedAt: string;
  /** Data Storage spec: calibration card detection data + light source direction. */
  cardboardMode: boolean;
  cardMarkersDetected: number[];
  cardAllMarkersVisible: boolean;
  cardIsFlat: boolean;
  lightDirection: { x: number; y: number } | null;
  /**
   * The primary color-calibration artifact under the video-first
   * design: a full-frame clip (not cropped, see videoRecorder.ts)
   * recorded across the whole Active Sweep window. The still image
   * (blob above) is a single uncompressed anchor frame, not a
   * competing source of truth. Null when unsupported or recording
   * failed for any reason.
   */
  videoBlob: Blob | null;
  videoMimeType: string | null;
  videoDurationMs: number | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCapture(capture: StoredCapture): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(capture);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listCaptures(): Promise<StoredCapture[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const rows = req.result as StoredCapture[];
      rows.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCapture(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearCaptures(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
