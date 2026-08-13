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
  blob: Blob;
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
