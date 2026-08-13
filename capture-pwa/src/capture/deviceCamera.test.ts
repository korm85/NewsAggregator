import { describe, expect, it } from 'vitest';
import { pickMaxResolutionConstraints } from './deviceCamera';

function makeCapabilities(overrides: Partial<MediaTrackCapabilities> = {}): MediaTrackCapabilities {
  return { ...overrides };
}

describe('pickMaxResolutionConstraints', () => {
  it('requests the device-reported max width/height as ideal, alongside a 30fps ideal', () => {
    const constraints = pickMaxResolutionConstraints(
      makeCapabilities({ width: { min: 1, max: 4032 }, height: { min: 1, max: 3024 } }),
    );
    expect(constraints).toEqual({
      width: { ideal: 4032 },
      height: { ideal: 3024 },
      frameRate: { ideal: 30 },
    });
  });

  it('returns null when width/height capabilities are missing (e.g. Safari, the fake test camera)', () => {
    expect(pickMaxResolutionConstraints(makeCapabilities())).toBeNull();
  });

  it('returns null when only one of width/height is reported', () => {
    expect(pickMaxResolutionConstraints(makeCapabilities({ width: { min: 1, max: 4032 } }))).toBeNull();
  });
});
