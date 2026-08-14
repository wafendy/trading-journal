import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createScreenshotStore, BadRequestError, type ScreenshotStore } from './screenshots';

async function pngBytes(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
}

describe('ScreenshotStore', () => {
  let dir: string;
  let store: ScreenshotStore;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'shots-')); store = createScreenshotStore(dir); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('saves a PNG re-encoded to WebP and reads it back', async () => {
    await store.save(42, await pngBytes(), 'image/png');
    expect(existsSync(join(dir, '42.webp'))).toBe(true);
    const out = await store.read(42);
    expect(out).not.toBeNull();
    const meta = await sharp(out as Buffer).metadata();
    expect(meta.format).toBe('webp');
  });

  it('read returns null when no file exists', async () => {
    expect(await store.read(999)).toBeNull();
  });

  it('remove deletes the file and is idempotent', async () => {
    await store.save(7, await pngBytes(), 'image/png');
    await store.remove(7);
    expect(existsSync(join(dir, '7.webp'))).toBe(false);
    await store.remove(7); // second time must not throw
    expect(await store.read(7)).toBeNull();
  });

  it('rejects a disallowed mime type', async () => {
    await expect(store.save(1, Buffer.from('x'), 'application/pdf')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('creates the directory on first save', async () => {
    const nested = join(dir, 'nested', 'deep');
    const s = createScreenshotStore(nested);
    await s.save(3, await pngBytes(), 'image/png');
    expect(existsSync(join(nested, '3.webp'))).toBe(true);
  });
});

describe('ScreenshotStore variants', () => {
  let dir: string;
  let store: ScreenshotStore;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'shots-v-')); store = createScreenshotStore(dir); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('saves and reads signal/pixel variants as WebP without touching the base chart', async () => {
    await store.saveVariant(5, 'signal', await pngBytes(), 'image/png');
    await store.saveVariant(5, 'pixel', await pngBytes(), 'image/png');
    expect(existsSync(join(dir, '5-signal.webp'))).toBe(true);
    expect(existsSync(join(dir, '5-pixel.webp'))).toBe(true);
    expect(existsSync(join(dir, '5.webp'))).toBe(false); // base chart untouched
    const sig = await store.readVariant(5, 'signal');
    expect((await sharp(sig as Buffer).metadata()).format).toBe('webp');
  });

  it('readVariant returns null when missing; ageMs null when missing, small when present', async () => {
    expect(await store.readVariant(9, 'signal')).toBeNull();
    expect(await store.ageMs(9, 'signal')).toBeNull();
    await store.saveVariant(9, 'signal', await pngBytes(), 'image/png');
    const age = await store.ageMs(9, 'signal');
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(0);
    expect(age as number).toBeLessThan(60_000);
  });

  it('removeVariant deletes one variant, is idempotent, leaves the other', async () => {
    await store.saveVariant(3, 'signal', await pngBytes(), 'image/png');
    await store.saveVariant(3, 'pixel', await pngBytes(), 'image/png');
    await store.removeVariant(3, 'signal');
    expect(await store.readVariant(3, 'signal')).toBeNull();
    expect(await store.readVariant(3, 'pixel')).not.toBeNull();
    await store.removeVariant(3, 'signal'); // idempotent
  });
});
