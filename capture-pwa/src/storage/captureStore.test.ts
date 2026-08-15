import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearCaptures, deleteCapture, listCaptures, saveCapture, type StoredCapture } from './captureStore';

function makeCapture(overrides: Partial<StoredCapture> = {}): StoredCapture {
  return {
    id: Math.random().toString(36).slice(2),
    blob: new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }),
    stillCandidates: [new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' })],
    stillScores: [1],
    bestStillIndex: 0,
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
    videoBlob: null,
    videoMimeType: null,
    videoDurationMs: null,
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

  it('round-trips all still candidates and the best-pick index', async () => {
    const capture = makeCapture({
      id: 'multi-still',
      stillCandidates: [
        new Blob(['frame-0'], { type: 'image/jpeg' }),
        new Blob(['frame-1'], { type: 'image/jpeg' }),
        new Blob(['frame-2'], { type: 'image/jpeg' }),
      ],
      stillScores: [10, 25, 5],
      bestStillIndex: 1,
    });
    await saveCapture(capture);

    const all = await listCaptures();
    const stored = all.find((c) => c.id === 'multi-still')!;
    expect(stored.stillCandidates).toHaveLength(3);
    expect(stored.stillCandidates.every((b) => b instanceof Blob)).toBe(true);
    expect(stored.stillScores).toEqual([10, 25, 5]);
    expect(stored.bestStillIndex).toBe(1);
  });

  it('round-trips the supplementary video fields when present, and stays null when absent', async () => {
    const withVideo = makeCapture({
      id: 'with-video',
      videoBlob: new Blob(['fake-webm-bytes'], { type: 'video/webm' }),
      videoMimeType: 'video/webm',
      videoDurationMs: 5000,
    });
    const withoutVideo = makeCapture({ id: 'without-video' });
    await saveCapture(withVideo);
    await saveCapture(withoutVideo);

    const all = await listCaptures();
    const stored = all.find((c) => c.id === 'with-video')!;
    expect(stored.videoBlob).toBeInstanceOf(Blob);
    expect(stored.videoMimeType).toBe('video/webm');
    expect(stored.videoDurationMs).toBe(5000);

    const storedNoVideo = all.find((c) => c.id === 'without-video')!;
    expect(storedNoVideo.videoBlob).toBeNull();
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
