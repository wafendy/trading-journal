import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Thrown for a disallowed upload (bad mime type). Mapped to HTTP 400. */
export class BadRequestError extends Error {}

export type ScreenshotVariant = 'signal' | 'pixel';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface ScreenshotStore {
  /** Re-encode arbitrary image bytes to WebP and store as <id>.webp (overwrites). */
  save(id: number, bytes: Buffer, mimeType: string): Promise<void>;
  /** Read stored WebP bytes, or null if none exists. */
  read(id: number): Promise<Buffer | null>;
  /** Delete <id>.webp if present (idempotent). Never throws for a missing file. */
  remove(id: number): Promise<void>;
  /** Store an auto-captured variant as <id>-<variant>.webp (overwrites). */
  saveVariant(id: number, variant: ScreenshotVariant, bytes: Buffer, mimeType: string): Promise<void>;
  readVariant(id: number, variant: ScreenshotVariant): Promise<Buffer | null>;
  removeVariant(id: number, variant: ScreenshotVariant): Promise<void>;
  /** Milliseconds since the variant file was written, or null if it doesn't exist. */
  ageMs(id: number, variant: ScreenshotVariant): Promise<number | null>;
}

export function createScreenshotStore(dir: string): ScreenshotStore {
  const pathForKey = (key: string) => join(dir, `${key}.webp`);
  const pathFor = (id: number) => pathForKey(String(id));
  const variantKey = (id: number, v: ScreenshotVariant) => `${id}-${v}`;

  const writeWebp = async (file: string, bytes: Buffer, mimeType: string) => {
    if (!ALLOWED.has(mimeType)) throw new BadRequestError(`unsupported image type: ${mimeType}`);
    await mkdir(dir, { recursive: true });
    const webp = await sharp(bytes).webp({ quality: 85 }).toBuffer();
    await writeFile(file, webp);
  };
  const readFileOrNull = async (file: string): Promise<Buffer | null> => {
    try { return await readFile(file); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
  };

  return {
    save: (id, bytes, mimeType) => writeWebp(pathFor(id), bytes, mimeType),
    read: (id) => readFileOrNull(pathFor(id)),
    remove: (id) => rm(pathFor(id), { force: true }),
    saveVariant: (id, v, bytes, mimeType) => writeWebp(pathForKey(variantKey(id, v)), bytes, mimeType),
    readVariant: (id, v) => readFileOrNull(pathForKey(variantKey(id, v))),
    removeVariant: (id, v) => rm(pathForKey(variantKey(id, v)), { force: true }),
    async ageMs(id, v) {
      try { return Math.max(0, Date.now() - (await stat(pathForKey(variantKey(id, v)))).mtimeMs); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
    },
  };
}
