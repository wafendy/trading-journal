import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Thrown for a disallowed upload (bad mime type). Mapped to HTTP 400. */
export class BadRequestError extends Error {}

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface ScreenshotStore {
  /** Re-encode arbitrary image bytes to WebP and store as <id>.webp (overwrites). */
  save(id: number, bytes: Buffer, mimeType: string): Promise<void>;
  /** Read stored WebP bytes, or null if none exists. */
  read(id: number): Promise<Buffer | null>;
  /** Delete <id>.webp if present (idempotent). Never throws for a missing file. */
  remove(id: number): Promise<void>;
}

export function createScreenshotStore(dir: string): ScreenshotStore {
  const pathFor = (id: number) => join(dir, `${id}.webp`);
  return {
    async save(id, bytes, mimeType) {
      if (!ALLOWED.has(mimeType)) throw new BadRequestError(`unsupported image type: ${mimeType}`);
      await mkdir(dir, { recursive: true });
      const webp = await sharp(bytes).webp({ quality: 85 }).toBuffer();
      await writeFile(pathFor(id), webp);
    },
    async read(id) {
      try {
        return await readFile(pathFor(id));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(id) {
      await rm(pathFor(id), { force: true });
    },
  };
}
