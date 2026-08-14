// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseClip, createPlaywrightCapturer } from './t1moCapture';

describe('parseClip', () => {
  it('parses "x,y,w,h"', () => {
    expect(parseClip('10,20,800,400')).toEqual({ x: 10, y: 20, width: 800, height: 400 });
  });
  it('returns null for junk / missing', () => {
    expect(parseClip(undefined)).toBeNull();
    expect(parseClip('1,2,3')).toBeNull();
    expect(parseClip('a,b,c,d')).toBeNull();
  });
});

describe('createPlaywrightCapturer', () => {
  it('returns null when the feature flag is off', () => {
    expect(createPlaywrightCapturer({} as NodeJS.ProcessEnv)).toBeNull();
    expect(createPlaywrightCapturer({ VITE_T1MO_CAPTURE: 'false' } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('enabled but missing clips → configError message', () => {
    const cap = createPlaywrightCapturer({ VITE_T1MO_CAPTURE: 'true', VITE_T1MO_URL_TEMPLATE: 'https://x/{{TICKER}}' } as NodeJS.ProcessEnv);
    expect(cap).not.toBeNull();
    expect(cap!.configError()).toMatch(/clip/i);
  });
  it('fully configured → configError null and default cacheMs 15min', () => {
    const cap = createPlaywrightCapturer({
      VITE_T1MO_CAPTURE: 'true',
      VITE_T1MO_URL_TEMPLATE: 'https://x/{{TICKER}}',
      T1MO_SIGNAL_CLIP: '0,0,10,10',
      T1MO_PIXEL_CLIP: '0,10,10,10',
    } as NodeJS.ProcessEnv);
    expect(cap!.configError()).toBeNull();
    expect(cap!.cacheMs).toBe(15 * 60_000);
  });
});
