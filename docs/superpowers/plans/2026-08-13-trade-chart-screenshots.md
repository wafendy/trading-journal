# Trade Chart Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach one chart screenshot per trade, stored on the filesystem as WebP, editable via an always-on "Chart" CTA in the History table and viewable read-only in the trade details modal.

**Architecture:** Screenshots are files at `<SCREENSHOTS_DIR>/<tradeId>.webp` — the trade's integer id is the only link, so there is no schema change. A small `ScreenshotStore` object (encode-to-WebP + read/write/delete, parameterized by directory) is injected into the Hono routes via `Deps`, mirroring how `getNextEarnings`/`getQuote` are injected. Three routes (POST/GET/DELETE) handle upload/serve/remove; uploads are re-encoded to WebP with `sharp`. The client uses a plain `<img>` pointed at the GET URL (404 → placeholder) plus a version counter for cache-busting after edits.

**Tech Stack:** Hono, Node (better-sqlite3 / Drizzle already present), `sharp` (new, native WebP encoder), Vite + React + TypeScript client, Tailwind v4, vitest.

## Global Constraints

- Node is provided via **mise** (Node 22). Prefix every node command with `eval "$(mise activate zsh)" && ` (a plain shell has no `node`/`npm`/`npx`). If a command fails with a stale `NODE_OPTIONS` preload error, prefix with `unset NODE_OPTIONS && ` as well.
- Money/calc logic is shared in `src/lib/` and imported by client and server; do not duplicate it. (Not needed for this feature, but do not violate it.)
- Git workflow: keep changes **staged but uncommitted** by default. This plan commits per task **because the design doc for this feature was committed under the brainstorming workflow and the user approved that**; each task ends with a real commit. Do **not** stage or commit `bun.lock`.
- Trade `id` stays an **integer**. No change to the `trades` schema.
- Screenshots are **always** stored as `<id>.webp` (uploads re-encoded). Accept only `image/png`, `image/jpeg`, `image/webp` on upload, max 10 MB.
- `GET` screenshot responses must send `Cache-Control: no-store`.
- The History "Chart" CTA is **always available** and MUST NOT depend on `VITE_ALLOW_HISTORY_EDIT` (that flag continues to gate only the Edit/Delete row actions).
- Tests: run with `eval "$(mise activate zsh)" && npm test` (vitest run). Typecheck with `npx tsc --noEmit`.

---

## File Structure

- **Create** `src/server/screenshots.ts` — `ScreenshotStore` interface + `createScreenshotStore(dir)` factory. Owns all file I/O and WebP encoding. No Hono/HTTP knowledge.
- **Modify** `src/server/routes.ts` — add `screenshots: ScreenshotStore` to `Deps`; add POST/GET/DELETE routes; add a `BadRequestError` mapping in `errorHandler`; best-effort delete on `cancel`/`deleteExited`.
- **Modify** `src/server/index.ts` — build the store from `SCREENSHOTS_DIR` (default `./screenshots`) and pass to `buildApp`.
- **Modify** `src/server/routes.test.ts` — inject a temp-dir store in `setup()`; add a `describe` block for the screenshot routes.
- **Create** `src/server/screenshots.test.ts` — unit tests for the store (encode + read/write/delete) against a temp dir.
- **Modify** `src/client/api.ts` — `screenshotUrl`, `uploadScreenshot`, `deleteScreenshot`.
- **Create** `src/client/components/ChartModal.tsx` — view + upload/paste + remove modal.
- **Modify** `src/client/components/HistoryTable.tsx` — always-on Chart CTA column + ChartModal wiring.
- **Modify** `src/client/components/TradeDetails.tsx` — read-only chart thumbnail + full-size lightbox.
- **Modify** `.gitignore` — add `screenshots/`.
- **Modify** `.env.sample` — document `SCREENSHOTS_DIR`.
- **Modify** `package.json` — add `sharp` dependency.

---

## Task 1: Add `sharp` dependency and gitignore the screenshots folder

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `.gitignore`
- Modify: `.env.sample`

**Interfaces:**
- Consumes: nothing.
- Produces: `sharp` available to import in server code; `screenshots/` ignored by git.

- [ ] **Step 1: Install sharp**

Run:
```bash
eval "$(mise activate zsh)" && npm install sharp
```
Expected: `sharp` appears under `dependencies` in `package.json`, install succeeds (native build completes under Node 22). If the native build fails, STOP and report — the fallback (store original PNG, skip conversion) is a design change requiring user sign-off.

- [ ] **Step 2: Verify sharp imports and encodes**

Run:
```bash
eval "$(mise activate zsh)" && node -e "const s=require('sharp'); s({create:{width:2,height:2,channels:3,background:{r:0,g:0,b:0}}}).webp().toBuffer().then(b=>console.log('webp bytes:',b.length))"
```
Expected: prints `webp bytes: <n>` with n > 0.

- [ ] **Step 3: Add `screenshots/` to .gitignore**

Add a line `screenshots/` to `.gitignore` (below the existing `backups/` line).

- [ ] **Step 4: Document SCREENSHOTS_DIR in .env.sample**

Add to `.env.sample` (above the `PORT` line):
```
# Directory for per-trade chart screenshots (stored as <tradeId>.webp).
# Optional — defaults to ./screenshots. Not required to run the app.
SCREENSHOTS_DIR=./screenshots
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .env.sample
git commit -m "chore: add sharp dependency and screenshots dir config"
```
(Do not stage `bun.lock`.)

---

## Task 2: `ScreenshotStore` — file I/O + WebP encoding

**Files:**
- Create: `src/server/screenshots.ts`
- Test: `src/server/screenshots.test.ts`

**Interfaces:**
- Consumes: `sharp`.
- Produces:
  ```ts
  export class BadRequestError extends Error {}
  export interface ScreenshotStore {
    // Re-encode arbitrary image bytes to WebP and store as <id>.webp (overwrites).
    save(id: number, bytes: Buffer, mimeType: string): Promise<void>;
    // Read stored WebP bytes, or null if none exists.
    read(id: number): Promise<Buffer | null>;
    // Delete <id>.webp if present (idempotent). Never throws for missing files.
    remove(id: number): Promise<void>;
  }
  export function createScreenshotStore(dir: string): ScreenshotStore;
  ```
  `save` throws `BadRequestError` for a disallowed `mimeType`. Allowed: `image/png`, `image/jpeg`, `image/webp`. (Size limit is enforced at the route layer, not here.)

- [ ] **Step 1: Write the failing test**

Create `src/server/screenshots.test.ts`:
```ts
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
    // Verify it's really WebP by decoding its metadata.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/screenshots.test.ts
```
Expected: FAIL — cannot find module `./screenshots`.

- [ ] **Step 3: Write the implementation**

Create `src/server/screenshots.ts`:
```ts
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Thrown for a disallowed upload (bad mime type). Mapped to HTTP 400. */
export class BadRequestError extends Error {}

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface ScreenshotStore {
  save(id: number, bytes: Buffer, mimeType: string): Promise<void>;
  read(id: number): Promise<Buffer | null>;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/screenshots.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit
```
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/server/screenshots.ts src/server/screenshots.test.ts
git commit -m "feat: add ScreenshotStore (WebP encode + file I/O)"
```

---

## Task 2b: `BadRequestError` → HTTP 400 in the error handler

**Files:**
- Modify: `src/server/routes.ts` (imports + `errorHandler`)

**Interfaces:**
- Consumes: `BadRequestError` from `./screenshots`.
- Produces: `errorHandler` maps `BadRequestError` to a 400 JSON response.

- [ ] **Step 1: Import BadRequestError**

In `src/server/routes.ts`, add to the existing repository import area:
```ts
import { BadRequestError } from './screenshots';
```

- [ ] **Step 2: Map it in errorHandler**

In `errorHandler`, add a branch **before** the generic 500 return:
```ts
  if (err instanceof BadRequestError) return c.json({ error: err.message }, 400);
```

- [ ] **Step 3: Typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit
```
Expected: no output. (Full route wiring lands in Task 3; this compiles because `BadRequestError` is a real export.)

- [ ] **Step 4: Commit**

```bash
git add src/server/routes.ts
git commit -m "feat: map BadRequestError to HTTP 400"
```

---

## Task 3: Screenshot routes + Deps wiring + orphan cleanup

**Files:**
- Modify: `src/server/routes.ts` (`Deps`, three routes, cleanup calls)
- Modify: `src/server/index.ts` (build + inject the store)
- Modify: `src/server/routes.test.ts` (`setup()` injects a temp-dir store; new `describe` block)

**Interfaces:**
- Consumes: `ScreenshotStore` (Task 2), `repo.getById`, `repo.cancel`, `repo.deleteExited`.
- Produces routes:
  - `POST /api/trades/:id/screenshot` — multipart field `file`; 404 if trade missing; 400 if not an image / > 10 MB / no file; 204 on success.
  - `GET /api/trades/:id/screenshot` — 200 `image/webp` + `Cache-Control: no-store`, or 404.
  - `DELETE /api/trades/:id/screenshot` — 204 (idempotent).

- [ ] **Step 1: Write failing route tests**

In `src/server/routes.test.ts`, first update `setup()` to inject a temp-dir-backed store. Add these imports at the top:
```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createScreenshotStore } from './screenshots';
```
Change the `buildApp(...)` call inside `setup()` to also pass a store, and return the dir:
```ts
  const shotsDir = mkdtempSync(join(tmpdir(), 'routes-shots-'));
  const screenshots = createScreenshotStore(shotsDir);
  const app = buildApp({ repo, now: () => clock, getNextEarnings: async () => earnings, getQuote: async () => quote, screenshots });
  return { app, repo, shotsDir, setClock: (c: string) => (clock = c), setEarnings: (d: string | null) => (earnings = d), setQuote: (p: number | null) => (quote = p) };
```
Then add a new describe block (helper builds a real PNG and posts it as multipart):
```ts
describe('screenshot routes', () => {
  const pngFile = async () => {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    return new File([bytes], 'chart.png', { type: 'image/png' });
  };
  const upload = async (app: ReturnType<typeof setup>['app'], id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return app.request(`/api/trades/${id}/screenshot`, { method: 'POST', body: fd });
  };

  it('uploads, serves, and deletes a screenshot', async () => {
    const { app } = setup();
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

    const up = await upload(app, created.id, await pngFile());
    expect(up.status).toBe(204);

    const get = await app.request(`/api/trades/${created.id}/screenshot`);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/webp');
    expect(get.headers.get('cache-control')).toContain('no-store');

    const del = await app.request(`/api/trades/${created.id}/screenshot`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect((await app.request(`/api/trades/${created.id}/screenshot`)).status).toBe(404);
  });

  it('GET returns 404 when there is no screenshot', async () => {
    const { app } = setup();
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    expect((await app.request(`/api/trades/${created.id}/screenshot`)).status).toBe(404);
  });

  it('upload to a nonexistent trade returns 404', async () => {
    const { app } = setup();
    expect((await upload(app, 99999, await pngFile())).status).toBe(404);
  });

  it('rejects a non-image upload with 400', async () => {
    const { app } = setup();
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const bad = new File([Buffer.from('not an image')], 'x.pdf', { type: 'application/pdf' });
    expect((await upload(app, created.id, bad)).status).toBe(400);
  });

  it('deletes the screenshot file when the trade is deleted', async () => {
    const { app } = setup();
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
    await app.request(`/api/trades/${created.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });
    await upload(app, created.id, await pngFile());
    await app.request(`/api/trades/${created.id}`, { method: 'DELETE' });
    expect((await app.request(`/api/trades/${created.id}/screenshot`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/routes.test.ts
```
Expected: FAIL — `buildApp` type error (missing `screenshots` in `Deps`) and/or route 404s because routes don't exist yet.

- [ ] **Step 3: Add `screenshots` to `Deps` and import the store type**

In `src/server/routes.ts`, add the import near the other server imports:
```ts
import type { ScreenshotStore } from './screenshots';
```
Extend `Deps` and the destructure:
```ts
export interface Deps { repo: TradeRepo; now: () => string; getNextEarnings: EarningsProvider; getQuote: QuoteProvider; screenshots: ScreenshotStore; }

export function registerRoutes(api: Hono, { repo, now, getNextEarnings, getQuote, screenshots }: Deps): void {
```

- [ ] **Step 4: Add the three routes**

In `src/server/routes.ts`, add immediately after the existing `DELETE /trades/:id` route:
```ts
  const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

  api.post('/trades/:id/screenshot', async (c) => {
    const id = Number(c.req.param('id'));
    repo.getById(id) ?? (() => { throw new NotFoundError(`trade ${id} not found`); })();
    const form = await c.req.parseBody();
    const file = form['file'];
    if (!(file instanceof File)) throw new BadRequestError('file is required');
    if (file.size > MAX_SCREENSHOT_BYTES) throw new BadRequestError('image exceeds 10MB');
    const bytes = Buffer.from(await file.arrayBuffer());
    await screenshots.save(id, bytes, file.type); // throws BadRequestError for bad type
    return c.body(null, 204);
  });

  api.get('/trades/:id/screenshot', async (c) => {
    const id = Number(c.req.param('id'));
    const bytes = await screenshots.read(id);
    if (!bytes) return c.body(null, 404);
    c.header('Content-Type', 'image/webp');
    c.header('Cache-Control', 'no-store');
    return c.body(bytes);
  });

  api.delete('/trades/:id/screenshot', async (c) => {
    await screenshots.remove(Number(c.req.param('id')));
    return c.body(null, 204);
  });
```
Note: `repo.getById` returns `undefined` for a missing trade; the `?? throw` pattern above matches the codebase's `NotFoundError` convention. If clearer, replace those two lines with:
```ts
    if (!repo.getById(id)) throw new NotFoundError(`trade ${id} not found`);
```
(Use the `if (!...)` form — it's clearer. The `getById` import is already available via `repo`.)

- [ ] **Step 5: Best-effort cleanup on cancel and delete**

Still in `src/server/routes.ts`, update the existing `cancel` and delete routes to remove the image after the repo op. Change:
```ts
  api.post('/trades/:id/cancel', (c) => {
    repo.cancel(Number(c.req.param('id')));
    return c.body(null, 204);
  });

  api.delete('/trades/:id', (c) => {
    repo.deleteExited(Number(c.req.param('id')));
    return c.body(null, 204);
  });
```
to:
```ts
  api.post('/trades/:id/cancel', async (c) => {
    const id = Number(c.req.param('id'));
    repo.cancel(id);
    await screenshots.remove(id); // best-effort; remove() never throws for missing files
    return c.body(null, 204);
  });

  api.delete('/trades/:id', async (c) => {
    const id = Number(c.req.param('id'));
    repo.deleteExited(id);
    await screenshots.remove(id);
    return c.body(null, 204);
  });
```

- [ ] **Step 6: Wire the store in `index.ts`**

In `src/server/index.ts`, add the import:
```ts
import { createScreenshotStore } from './screenshots';
```
And after the `getQuote` line:
```ts
const screenshots = createScreenshotStore(process.env.SCREENSHOTS_DIR ?? './screenshots');
```
Update the `buildApp` call:
```ts
const app = buildApp({ repo, now: () => new Date().toISOString(), getNextEarnings, getQuote, screenshots });
```

- [ ] **Step 7: Run route tests to verify they pass**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/routes.test.ts
```
Expected: PASS (existing tests + 5 new screenshot tests).

- [ ] **Step 8: Full test suite + typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit && npm test
```
Expected: typecheck clean; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/server/routes.ts src/server/index.ts src/server/routes.test.ts
git commit -m "feat: screenshot upload/serve/delete routes + orphan cleanup"
```

---

## Task 4: Client API helpers

**Files:**
- Modify: `src/client/api.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (on the `api` object):
  ```ts
  screenshotUrl(id: number, version: number): string;          // GET url with cache-buster
  uploadScreenshot(id: number, file: File): Promise<void>;     // POST multipart; throws on !ok
  deleteScreenshot(id: number): Promise<void>;                 // DELETE; throws on !ok
  ```

- [ ] **Step 1: Add the helpers**

In `src/client/api.ts`, inside the `api` object (near the other `/trades/:id/...` helpers), add:
```ts
  screenshotUrl: (id: number, version: number) => `/api/trades/${id}/screenshot?v=${version}`,
  uploadScreenshot: (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`/api/trades/${id}/screenshot`, { method: 'POST', body: fd })
      .then((r) => { if (!r.ok) throw new Error('upload failed'); });
  },
  deleteScreenshot: (id: number) =>
    fetch(`/api/trades/${id}/screenshot`, { method: 'DELETE' })
      .then((r) => { if (!r.ok) throw new Error('delete failed'); }),
```

- [ ] **Step 2: Typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/client/api.ts
git commit -m "feat: client api helpers for trade screenshots"
```

---

## Task 5: ChartModal (view + upload/paste + remove)

**Files:**
- Create: `src/client/components/ChartModal.tsx`

**Interfaces:**
- Consumes: `Modal` from `./ExitForm` (accepts `size?: 'md' | 'lg' | 'xl'`), `useToast` from `./Toast`, `api.screenshotUrl/uploadScreenshot/deleteScreenshot`, `TradeDTO`.
- Produces: `export function ChartModal({ trade, onClose }: { trade: TradeDTO; onClose: () => void })`.

- [ ] **Step 1: Create the component**

Create `src/client/components/ChartModal.tsx`:
```tsx
import { useState } from 'react';
import { api } from '../api';
import { Modal } from './ExitForm';
import { useToast } from './Toast';
import type { TradeDTO } from '../../lib/types';

const MAX_BYTES = 10 * 1024 * 1024;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** View, upload/paste, and remove the single chart screenshot for a trade. */
export function ChartModal({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const toast = useToast();
  // Bumped after upload/remove to force the <img> to refetch (responses are no-store).
  const [version, setVersion] = useState(1);
  const [hasImage, setHasImage] = useState(true); // assume present; onError flips to placeholder
  const [busy, setBusy] = useState(false);

  const doUpload = async (file: File) => {
    if (!OK_TYPES.includes(file.type)) { toast('Only PNG, JPEG or WebP images are allowed', 'error'); return; }
    if (file.size > MAX_BYTES) { toast('Image exceeds 10MB', 'error'); return; }
    setBusy(true);
    try {
      await api.uploadScreenshot(trade.id, file);
      setHasImage(true);
      setVersion((v) => v + 1);
      toast('Chart updated');
    } catch (err) {
      toast((err as Error)?.message ?? 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files)[0];
    if (file) { e.preventDefault(); doUpload(file); }
  };

  const doRemove = async () => {
    setBusy(true);
    try {
      await api.deleteScreenshot(trade.id);
      setHasImage(false);
      setVersion((v) => v + 1);
      toast('Chart removed');
    } catch (err) {
      toast((err as Error)?.message ?? 'Remove failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${trade.ticker} — chart`} onClose={onClose} size="xl">
      <div
        onPaste={onPaste}
        className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600"
        tabIndex={0}
      >
        {hasImage ? (
          <img
            src={api.screenshotUrl(trade.id, version)}
            alt={`${trade.ticker} chart`}
            className="mx-auto max-h-[60vh] w-auto rounded"
            onError={() => setHasImage(false)}
          />
        ) : (
          <div className="grid h-40 place-items-center text-sm text-slate-500 dark:text-slate-400">
            No chart attached — choose a file or paste an image (Cmd+V) here.
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <label className="cursor-pointer rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white">
          {busy ? 'Working…' : hasImage ? 'Replace image' : 'Choose image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ''; }}
          />
        </label>
        <div className="flex gap-2">
          {hasImage && (
            <button onClick={doRemove} disabled={busy} className="cursor-pointer rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Remove</button>
          )}
          <button onClick={onClose} className="cursor-pointer rounded bg-slate-300 px-3 py-1.5 text-sm text-slate-900 dark:bg-slate-600 dark:text-slate-100">Close</button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Images are converted to WebP automatically. Max 10MB.</p>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit
```
Expected: no output. (Component is not yet mounted anywhere; that's fine — it's a valid module.)

- [ ] **Step 3: Commit**

```bash
git add src/client/components/ChartModal.tsx
git commit -m "feat: ChartModal for viewing/uploading trade chart screenshots"
```

---

## Task 6: Always-on Chart CTA in the History table

**Files:**
- Modify: `src/client/components/HistoryTable.tsx`

**Interfaces:**
- Consumes: `ChartModal` (Task 5), `TradeDTO`.
- Produces: a Chart button per history row (independent of `ALLOW_EDIT`) that opens `ChartModal`.

- [ ] **Step 1: Import ChartModal and add state**

In `src/client/components/HistoryTable.tsx`, add the import:
```ts
import { ChartModal } from './ChartModal';
```
Next to the other `useState` hooks (near `deleting`), add:
```ts
  const [charting, setCharting] = useState<TradeDTO | null>(null);
```

- [ ] **Step 2: Add a Chart header column (always present)**

In the `<thead>`, the header currently ends with:
```tsx
          <th className={th}>UPETI</th><th className={th}>Exit</th><th className={th}>Realized P&L</th>{ALLOW_EDIT && <th className={th}>Actions</th>}
```
Change to add a Chart header before the conditional Actions header:
```tsx
          <th className={th}>UPETI</th><th className={th}>Exit</th><th className={th}>Realized P&L</th><th className={th}>Chart</th>{ALLOW_EDIT && <th className={th}>Actions</th>}
```

- [ ] **Step 3: Add the Chart cell in each row**

Immediately BEFORE the `{ALLOW_EDIT && ( ... )}` actions cell block, add an always-present cell:
```tsx
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setCharting(t)} className="cursor-pointer rounded bg-slate-300 px-2 py-0.5 text-xs text-slate-900 dark:bg-slate-600 dark:text-slate-100">Chart</button>
              </td>
```

- [ ] **Step 4: Update the empty-state colSpan**

The empty row currently reads `colSpan={ALLOW_EDIT ? 7 : 6}`. One column was added (Chart) in both cases. Change to:
```tsx
          {rows.length === 0 && <tr><td colSpan={ALLOW_EDIT ? 8 : 7} className="px-3 py-3 text-slate-500 dark:text-slate-500">No exited trades yet.</td></tr>}
```

- [ ] **Step 5: Mount the ChartModal**

Near the bottom where `TradeDetails`/`EditHistoryForm`/delete `Modal` are conditionally rendered, add:
```tsx
      {charting && <ChartModal trade={charting} onClose={() => setCharting(null)} />}
```

- [ ] **Step 6: Typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/client/components/HistoryTable.tsx
git commit -m "feat: always-on Chart CTA in the history table"
```

---

## Task 7: Read-only chart thumbnail + lightbox in TradeDetails

**Files:**
- Modify: `src/client/components/TradeDetails.tsx`

**Interfaces:**
- Consumes: `api.screenshotUrl`, `useState` from React.
- Produces: a read-only chart section in the details modal; clicking a present image opens a full-size overlay.

- [ ] **Step 1: Add imports and lightbox state**

In `src/client/components/TradeDetails.tsx`:
- Add to the React import (currently `import type { ReactNode } from 'react';`): add a value import at the top of the file:
  ```ts
  import { useState } from 'react';
  ```
- Add `import { api } from '../api';`
- Inside `TradeDetails`, add state:
  ```ts
  const [hasChart, setHasChart] = useState(true);
  const [lightbox, setLightbox] = useState(false);
  ```

- [ ] **Step 2: Add the read-only Chart section**

Immediately before the Notes section (`<div className="mt-4"> ... Notes ...`), add:
```tsx
      <section className="mt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Chart</h3>
        {hasChart ? (
          <img
            src={api.screenshotUrl(trade.id, 1)}
            alt={`${trade.ticker} chart`}
            onError={() => setHasChart(false)}
            onClick={() => setLightbox(true)}
            className="max-h-64 w-auto cursor-zoom-in rounded border border-slate-200 dark:border-slate-700"
          />
        ) : (
          <p className="text-sm italic text-slate-500 dark:text-slate-400">No chart attached.</p>
        )}
      </section>
```

- [ ] **Step 3: Add the lightbox overlay**

Just before the final closing `</Modal>` tag, add:
```tsx
      {lightbox && hasChart && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4" onClick={() => setLightbox(false)}>
          <img src={api.screenshotUrl(trade.id, 1)} alt={`${trade.ticker} chart`} className="max-h-[90vh] max-w-[90vw] rounded" />
        </div>
      )}
```

- [ ] **Step 4: Typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 5: Manual smoke check (build)**

Run:
```bash
eval "$(mise activate zsh)" && npm run build
```
Expected: `tsc -b && vite build` completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/TradeDetails.tsx
git commit -m "feat: read-only chart thumbnail + lightbox in trade details"
```

---

## Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + full test suite**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit && npm test
```
Expected: typecheck clean; all tests pass (existing + `screenshots.test.ts` + new route tests).

- [ ] **Step 2: Manual end-to-end (optional, requires running app)**

With the app running (`npm run dev`, server auto-restarts to pick up new routes):
1. Open the History tab → click **Chart** on a row → modal shows the placeholder.
2. Choose a PNG (or paste with Cmd+V) → thumbnail appears; a `<id>.webp` file exists under `./screenshots/`.
3. Reopen the row's details → the chart shows read-only; click it → full-size lightbox.
4. Back in the Chart modal → **Remove** → placeholder returns; file is gone.

- [ ] **Step 3: Final commit (if any stray changes)**

```bash
git status
# If anything remains unstaged from the tasks above, review and commit it with an appropriate message.
```

---

## Self-Review Notes

- **Spec coverage:** storage as `<id>.webp` (Task 2), WebP auto-convert (Task 2), POST/GET/DELETE routes with no-store + limits (Task 3), orphan cleanup on cancel/delete (Task 3), `SCREENSHOTS_DIR` (Tasks 1, 3), always-on History CTA independent of `VITE_ALLOW_HISTORY_EDIT` (Task 6), read-only chart in details + lightbox (Task 7), route/store tests (Tasks 2, 3), `sharp` dependency (Task 1), `screenshots/` gitignored (Task 1). All covered.
- **Type consistency:** `ScreenshotStore.save/read/remove` signatures match between Task 2 (definition) and Task 3 (use). `api.screenshotUrl(id, version)` matches its use in Tasks 5 and 7. `Deps.screenshots` added in Task 3 and injected in `index.ts` (Task 3) and test setup (Task 3).
- **No placeholders:** every code step contains real code; test steps contain real assertions.
