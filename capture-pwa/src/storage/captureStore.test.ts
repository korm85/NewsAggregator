import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearCaptures, deleteCapture, listCaptures, saveCapture, type StoredCapture } from './captureStore';

function makeCapture(overrides: Partial<StoredCapture> = {}): StoredCapture {
  return {
    id: Math.random().toString(36).slice(2),
    blob: new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }),
    offAxisDeg: 8,
    offAxisVec: { x: 0.1, y: -0.05 },
    rollDeg: 1.2,
    pitchDeg: 4,
    yawDeg: 7,
    mar: 0.4,
    smileWidthRatio: 1.3,
    mouthBoxWidth: 0.35,
    mouthBoxHeight: 0.15,
    exposureLockSuccess: true,
    captureMode: 'front',
    capturedAt: new Date().toISOString(),
    cardboardMode: false,
    cardMarkersDetected: [],
    cardAllMarkersVisible: false,
    cardIsFlat: false,
    lightDirection: null,
    ...overrides,
  };
}

describe('captureStore', () => {
  beforeEach(async () => {
    await clearCaptures();
  });

  it('round-trips a saved capture', async () => {
    const capture = makeCapture({ id: 'a', offAxisDeg: 6.5 });
    await saveCapture(capture);

    const all = await listCaptures();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('a');
    expect(all[0].offAxisDeg).toBe(6.5);
    expect(all[0].blob).toBeInstanceOf(Blob);
  });

  it('lists newest capture first', async () => {
    await saveCapture(makeCapture({ id: 'first', capturedAt: '2026-01-01T00:00:00.000Z' }));
    await saveCapture(makeCapture({ id: 'second', capturedAt: '2026-01-01T00:00:05.000Z' }));

    const all = await listCaptures();
    expect(all.map((c) => c.id)).toEqual(['second', 'first']);
  });

  it('deletes a single capture without affecting others', async () => {
    await saveCapture(makeCapture({ id: 'keep' }));
    await saveCapture(makeCapture({ id: 'remove' }));

    await deleteCapture('remove');

    const all = await listCaptures();
    expect(all.map((c) => c.id)).toEqual(['keep']);
  });

  it('clears every capture', async () => {
    await saveCapture(makeCapture({ id: 'one' }));
    await saveCapture(makeCapture({ id: 'two' }));

    await clearCaptures();

    expect(await listCaptures()).toHaveLength(0);
  });
});
