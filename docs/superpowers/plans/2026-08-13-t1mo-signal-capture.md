# T1mo Signal Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global "Refresh T1mo Signal" button in Active Positions that drives a local Vivaldi browser (Playwright/CDP) to capture two clip-region screenshots (Signal, Pixel) per active ticker, shown as ≤50×75px row thumbnails, cached 15 minutes and removed when a position is exited.

**Architecture:** Server-side capture engine (`t1moCapture.ts`) spawns Vivaldi with a persistent profile, connects over CDP, and screenshots two configured clip rectangles per ticker; it sits behind a `T1moCapturer` interface so routes/store are testable without a browser. Captured PNGs are re-encoded to WebP and stored per trade+variant via the existing screenshot store (`<id>-signal.webp` / `<id>-pixel.webp`). A `POST /api/t1mo/capture` route captures only stale (missing or >TTL) tickers; the exit path deletes the variants.

**Tech Stack:** Playwright (CDP connect to Vivaldi), Node child_process, sharp (WebP), Hono, Vite + React + TS + Tailwind, vitest.

## Global Constraints

- **Stage only, do NOT commit.** Every task's final step is `git add <paths>` (no `git commit`). Never stage `bun.lock`.
- Node via **mise**: prefix node commands with `eval "$(mise activate zsh)" && `. If a stale `NODE_OPTIONS` preload error appears, also prefix `unset NODE_OPTIONS && `.
- Typecheck: `npx tsc --noEmit`. Tests: `npm test` (vitest run). Client-only build check: `npm run build`.
- Trade `id` stays integer; no schema change. The id is the only link to its screenshot files.
- Screenshot files: manual chart `<id>.webp` (unchanged); T1mo variants `<id>-signal.webp`, `<id>-pixel.webp`. All WebP (re-encoded on save).
- Feature flag: client button + column shown only when `import.meta.env.VITE_T1MO_CAPTURE === 'true'`; server route returns 400 when the capturer is disabled/misconfigured.
- Capture URL reuses `VITE_T1MO_URL_TEMPLATE` (server reads it from `process.env`, available via `--env-file=.env`); `{{TICKER}}` is the placeholder (uppercased, URL-encoded).
- `src/server/routes.test.ts` already begins with `// @vitest-environment node` — keep it (binary uploads/screenshots need Node, not jsdom).
- Cache = file mtime; a ticker is stale if either variant is missing or older than `T1MO_CACHE_MINUTES` (default 15).
- Thumbnails: `max-h-[50px] max-w-[75px] object-contain`.

---

## File Structure

- **Modify** `src/server/screenshots.ts` — add variant-aware `saveVariant`/`readVariant`/`removeVariant`/`ageMs` alongside the existing chart methods.
- **Create** `src/server/t1moCapture.ts` — `T1moCapturer` interface, `CaptureResult`, `parseClip`, `readT1moConfig`, `createPlaywrightCapturer` (untested browser impl), `ConflictError` reused from repository.
- **Modify** `src/server/routes.ts` — `Deps` gains `t1moCapturer: T1moCapturer | null`; add `POST /t1mo/capture`; extend GET screenshot with `?variant=`; delete variants in the exit path.
- **Modify** `src/server/index.ts` — build the capturer from env, pass into `buildApp`.
- **Modify** `src/server/screenshots.test.ts` — variant + ageMs tests.
- **Modify** `src/server/routes.test.ts` — capture-route tests with a fake capturer; inject `t1moCapturer` in `setup()`.
- **Modify** `src/client/api.ts` — `t1moThumbUrl`, `captureT1mo`.
- **Modify** `src/client/components/PlanTables.tsx` — flag-gated button, T1mo column (two thumbnails), lightbox.
- **Modify** `.env.sample` — document new vars.

---

## Task 1: ScreenshotStore variant methods + ageMs

**Files:**
- Modify: `src/server/screenshots.ts`
- Test: `src/server/screenshots.test.ts`

**Interfaces:**
- Consumes: `sharp` (already used).
- Produces (added to `ScreenshotStore`):
  ```ts
  type ScreenshotVariant = 'signal' | 'pixel';
  saveVariant(id: number, variant: ScreenshotVariant, bytes: Buffer, mimeType: string): Promise<void>;
  readVariant(id: number, variant: ScreenshotVariant): Promise<Buffer | null>;
  removeVariant(id: number, variant: ScreenshotVariant): Promise<void>;
  ageMs(id: number, variant: ScreenshotVariant): Promise<number | null>; // Date.now()-mtime, null if missing
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/server/screenshots.test.ts` (inside the file, after the existing `describe`):
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/screenshots.test.ts
```
Expected: FAIL — `saveVariant`/`readVariant`/`removeVariant`/`ageMs` not on the store.

- [ ] **Step 3: Implement variant methods**

In `src/server/screenshots.ts`: add `stat` to the fs import, export the variant type, extend the interface and the factory. Replace the file's contents with:
```ts
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Thrown for a disallowed upload (bad mime type). Mapped to HTTP 400. */
export class BadRequestError extends Error {}

export type ScreenshotVariant = 'signal' | 'pixel';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface ScreenshotStore {
  save(id: number, bytes: Buffer, mimeType: string): Promise<void>;
  read(id: number): Promise<Buffer | null>;
  remove(id: number): Promise<void>;
  saveVariant(id: number, variant: ScreenshotVariant, bytes: Buffer, mimeType: string): Promise<void>;
  readVariant(id: number, variant: ScreenshotVariant): Promise<Buffer | null>;
  removeVariant(id: number, variant: ScreenshotVariant): Promise<void>;
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
      try { return Date.now() - (await stat(pathForKey(variantKey(id, v)))).mtimeMs; }
      catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/screenshots.test.ts && npx tsc --noEmit
```
Expected: all screenshots tests pass; typecheck clean.

- [ ] **Step 5: Stage**

```bash
git add src/server/screenshots.ts src/server/screenshots.test.ts
```

---

## Task 2: T1mo capture module (interface, config, single-flight, Playwright impl)

**Files:**
- Create: `src/server/t1moCapture.ts`
- Test: `src/server/t1moCapture.test.ts`

**Interfaces:**
- Consumes: `ConflictError` from `./repository`; `spawn` from `node:child_process`; `chromium` from `playwright`.
- Produces:
  ```ts
  export type Clip = { x: number; y: number; width: number; height: number };
  export function parseClip(s: string | undefined): Clip | null; // "x,y,w,h" -> Clip, else null
  export type CaptureResult = { signal: Buffer; pixel: Buffer } | { error: string };
  export interface T1moCapturer {
    readonly cacheMs: number;
    configError(): string | null;                       // null = ready; message = 400 reason
    capture(tickers: string[]): Promise<Record<string, CaptureResult>>; // keyed by UPPERCASE ticker
  }
  export function createPlaywrightCapturer(env: NodeJS.ProcessEnv): T1moCapturer | null; // null if disabled
  ```
  `createPlaywrightCapturer` returns `null` when `env.VITE_T1MO_CAPTURE !== 'true'`. When enabled, `configError()` returns a message if `VITE_T1MO_URL_TEMPLATE`, `T1MO_SIGNAL_CLIP`, or `T1MO_PIXEL_CLIP` are missing/invalid. `capture()` throws `ConflictError` if a run is already in progress.

- [ ] **Step 1: Write the failing tests** (pure logic only — no browser)

Create `src/server/t1moCapture.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/t1moCapture.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/server/t1moCapture.ts`:
```ts
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { ConflictError } from './repository';

export type Clip = { x: number; y: number; width: number; height: number };

export function parseClip(s: string | undefined): Clip | null {
  if (!s) return null;
  const parts = s.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

function parseViewport(s: string | undefined): { width: number; height: number } {
  const parts = (s ?? '').split(',').map((n) => Number(n.trim()));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return { width: parts[0]!, height: parts[1]! };
  }
  return { width: 1280, height: 800 };
}

export type CaptureResult = { signal: Buffer; pixel: Buffer } | { error: string };

export interface T1moCapturer {
  readonly cacheMs: number;
  configError(): string | null;
  capture(tickers: string[]): Promise<Record<string, CaptureResult>>;
}

export function createPlaywrightCapturer(env: NodeJS.ProcessEnv): T1moCapturer | null {
  if (env.VITE_T1MO_CAPTURE !== 'true') return null;

  const urlTemplate = env.VITE_T1MO_URL_TEMPLATE ?? '';
  const signalClip = parseClip(env.T1MO_SIGNAL_CLIP);
  const pixelClip = parseClip(env.T1MO_PIXEL_CLIP);
  const viewport = parseViewport(env.T1MO_VIEWPORT);
  const vivaldiPath = env.T1MO_VIVALDI_PATH ?? '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi';
  const userDataDir = env.T1MO_USER_DATA_DIR ?? '/tmp/vivaldi-automation-profile';
  const cacheMs = (Number(env.T1MO_CACHE_MINUTES) || 15) * 60_000;
  const DEBUG_PORT = 9222; // ponytail: fixed CDP port; make env-configurable if it ever collides

  let inProgress = false;

  const url = (ticker: string) => urlTemplate.replace(/\{\{TICKER\}\}/g, encodeURIComponent(ticker.toUpperCase()));

  return {
    cacheMs,
    configError() {
      if (!urlTemplate) return 'VITE_T1MO_URL_TEMPLATE is not set';
      if (!signalClip) return 'T1MO_SIGNAL_CLIP must be "x,y,w,h"';
      if (!pixelClip) return 'T1MO_PIXEL_CLIP must be "x,y,w,h"';
      return null;
    },
    async capture(tickers) {
      if (inProgress) throw new ConflictError('a T1mo capture is already in progress');
      inProgress = true;
      const results: Record<string, CaptureResult> = {};
      const proc = spawn(vivaldiPath, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`], { detached: true, stdio: 'ignore' });
      try {
        await new Promise((r) => setTimeout(r, 2000)); // let Vivaldi open the debug port
        const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
        try {
          const context = browser.contexts()[0] ?? (await browser.newContext());
          const page = context.pages()[0] ?? (await context.newPage());
          await page.setViewportSize(viewport);
          for (const ticker of tickers) {
            const key = ticker.toUpperCase();
            try {
              await page.goto(url(ticker), { waitUntil: 'networkidle' });
              const signal = await page.screenshot({ clip: signalClip! });
              const pixel = await page.screenshot({ clip: pixelClip! });
              results[key] = { signal, pixel };
            } catch (err) {
              results[key] = { error: (err as Error)?.message ?? 'capture failed' };
            }
          }
        } finally {
          await browser.close();
        }
      } catch (err) {
        // Whole-run failure (Vivaldi missing, CDP connect fail): mark every ticker.
        const msg = (err as Error)?.message ?? 'browser launch failed';
        for (const t of tickers) results[t.toUpperCase()] ??= { error: msg };
      } finally {
        proc.kill();
        inProgress = false;
      }
      return results;
    },
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/t1moCapture.test.ts && npx tsc --noEmit
```
Expected: pure-logic tests pass; typecheck clean. (The browser path is not exercised by tests.)

- [ ] **Step 5: Stage**

```bash
git add src/server/t1moCapture.ts src/server/t1moCapture.test.ts
```

---

## Task 3: Routes — capture endpoint, variant GET, exit cleanup, wiring

**Files:**
- Modify: `src/server/routes.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/routes.test.ts`

**Interfaces:**
- Consumes: `T1moCapturer`/`CaptureResult` (Task 2), store variant methods (Task 1), `repo.list('filled')`, `repo.exit`.
- Produces:
  - `POST /api/t1mo/capture` → `{ results: {ticker,ok,error?}[], captured, failed, skipped }`; 400 disabled/misconfigured; 409 if a run is in progress.
  - `GET /api/trades/:id/screenshot?variant=signal|pixel` serves that variant; no `variant` → base chart.
  - Exit deletes both variants.
  - `Deps` gains `t1moCapturer: T1moCapturer | null`.

- [ ] **Step 1: Write failing route tests**

In `src/server/routes.test.ts`: update `setup()` to accept and inject a capturer, then add a describe block.

First, change the imports and `setup()` signature. Add near the other imports:
```ts
import type { T1moCapturer, CaptureResult } from './t1moCapture';
```
Change `setup()` to take an optional capturer and pass it in `buildApp`:
```ts
function setup(t1moCapturer: T1moCapturer | null = null) {
  // ...existing body up to buildApp...
  const app = buildApp({ repo, now: () => clock, getNextEarnings: async () => earnings, getQuote: async () => quote, screenshots, t1moCapturer });
  return { app, repo, shotsDir, setClock: (c: string) => (clock = c), setEarnings: (d: string | null) => (earnings = d), setQuote: (p: number | null) => (quote = p) };
}
```
Then append:
```ts
describe('T1mo capture route', () => {
  const okCapturer = (calls: string[][] = []): T1moCapturer => ({
    cacheMs: 15 * 60_000,
    configError: () => null,
    capture: async (tickers) => {
      calls.push(tickers);
      const out: Record<string, CaptureResult> = {};
      for (const t of tickers) out[t.toUpperCase()] = { signal: Buffer.from('sig'), pixel: Buffer.from('pix') };
      return out;
    },
  });
  const fill = async (app: ReturnType<typeof setup>['app'], ticker: string) => {
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ticker }) })).json();
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
    return created.id as number;
  };

  it('400 when the feature is disabled (no capturer)', async () => {
    const { app } = setup(null);
    expect((await app.request('/api/t1mo/capture', { method: 'POST' })).status).toBe(400);
  });

  it('400 when misconfigured', async () => {
    const { app } = setup({ cacheMs: 900000, configError: () => 'T1MO_SIGNAL_CLIP must be "x,y,w,h"', capture: async () => ({}) });
    expect((await app.request('/api/t1mo/capture', { method: 'POST' })).status).toBe(400);
  });

  it('captures stale filled tickers, saves both variants, serves them, reports counts', async () => {
    const calls: string[][] = [];
    const { app } = setup(okCapturer(calls));
    const id = await fill(app, 'aapl');
    const res = await app.request('/api/t1mo/capture', { method: 'POST' });
    expect(res.status).toBe(200);
    const jsonRes = await res.json();
    expect(jsonRes.captured).toBe(1);
    expect(calls[0]).toEqual(['AAPL']);
    const sig = await app.request(`/api/trades/${id}/screenshot?variant=signal`);
    expect(sig.status).toBe(200);
    expect(sig.headers.get('content-type')).toBe('image/webp');
    const pix = await app.request(`/api/trades/${id}/screenshot?variant=pixel`);
    expect(pix.status).toBe(200);
  });

  it('skips fresh tickers on a second run (no re-capture)', async () => {
    const calls: string[][] = [];
    const { app } = setup(okCapturer(calls));
    await fill(app, 'aapl');
    await app.request('/api/t1mo/capture', { method: 'POST' });
    const second = await (await app.request('/api/t1mo/capture', { method: 'POST' })).json();
    expect(second.captured).toBe(0);
    expect(second.skipped).toBe(1);
    expect(calls).toHaveLength(1); // capturer not called the second time
  });

  it('reports ok:false when the capturer returns an error for a ticker', async () => {
    const errCapturer: T1moCapturer = { cacheMs: 900000, configError: () => null, capture: async (t) => Object.fromEntries(t.map((x) => [x.toUpperCase(), { error: 'boom' }])) };
    const { app } = setup(errCapturer);
    await fill(app, 'aapl');
    const j = await (await app.request('/api/t1mo/capture', { method: 'POST' })).json();
    expect(j.failed).toBe(1);
    expect(j.results[0]).toMatchObject({ ticker: 'AAPL', ok: false });
  });

  it('409 when a capture is already in progress', async () => {
    const busy: T1moCapturer = { cacheMs: 900000, configError: () => null, capture: async () => { throw new ConflictError('busy'); } };
    const { app } = setup(busy);
    await fill(app, 'aapl');
    expect((await app.request('/api/t1mo/capture', { method: 'POST' })).status).toBe(409);
  });

  it('deletes both variants when the trade is exited', async () => {
    const { app } = setup(okCapturer());
    const id = await fill(app, 'aapl');
    await app.request('/api/t1mo/capture', { method: 'POST' });
    await app.request(`/api/trades/${id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });
    expect((await app.request(`/api/trades/${id}/screenshot?variant=signal`)).status).toBe(404);
    expect((await app.request(`/api/trades/${id}/screenshot?variant=pixel`)).status).toBe(404);
  });
});
```
Add the `ConflictError` import to the test file if not present:
```ts
import { ConflictError } from './repository';
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
eval "$(mise activate zsh)" && npx vitest run src/server/routes.test.ts
```
Expected: FAIL — `Deps` has no `t1moCapturer`; route/variant/exit-cleanup not implemented.

- [ ] **Step 3: Add capturer to Deps and import types**

In `src/server/routes.ts`, add the import near the screenshots import:
```ts
import type { T1moCapturer, CaptureResult } from './t1moCapture';
```
Extend `Deps` and destructure:
```ts
export interface Deps { repo: TradeRepo; now: () => string; getNextEarnings: EarningsProvider; getQuote: QuoteProvider; screenshots: ScreenshotStore; t1moCapturer: T1moCapturer | null; }

export function registerRoutes(api: Hono, { repo, now, getNextEarnings, getQuote, screenshots, t1moCapturer }: Deps): void {
```

- [ ] **Step 4: Extend the GET screenshot route with ?variant**

Replace the existing `api.get('/trades/:id/screenshot', ...)` handler body so it serves a variant when asked:
```ts
  api.get('/trades/:id/screenshot', async (c) => {
    const id = Number(c.req.param('id'));
    const variant = c.req.query('variant');
    const bytes = variant === 'signal' || variant === 'pixel'
      ? await screenshots.readVariant(id, variant)
      : await screenshots.read(id);
    if (!bytes) return c.body(null, 404);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Response(ab as ArrayBuffer, { status: 200, headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' } });
  });
```

- [ ] **Step 5: Add the capture route**

Add after the DELETE screenshot route (before the `exit` route):
```ts
  api.post('/t1mo/capture', async (c) => {
    if (!t1moCapturer) return c.json({ error: 'T1mo capture is disabled (set VITE_T1MO_CAPTURE=true)' }, 400);
    const cfgErr = t1moCapturer.configError();
    if (cfgErr) return c.json({ error: cfgErr }, 400);

    const filled = repo.list('filled');
    const cutoff = t1moCapturer.cacheMs;
    const stale: typeof filled = [];
    for (const t of filled) {
      const sAge = await screenshots.ageMs(t.id, 'signal');
      const pAge = await screenshots.ageMs(t.id, 'pixel');
      if (sAge == null || pAge == null || sAge > cutoff || pAge > cutoff) stale.push(t);
    }
    const tickers = [...new Set(stale.map((t) => t.ticker.toUpperCase()))];
    const captured: Record<string, CaptureResult> = tickers.length ? await t1moCapturer.capture(tickers) : {};

    const results: { ticker: string; ok: boolean; error?: string }[] = [];
    let ok = 0, failed = 0;
    for (const t of stale) {
      const r = captured[t.ticker.toUpperCase()];
      if (!r) { failed++; results.push({ ticker: t.ticker, ok: false, error: 'no result' }); continue; }
      if ('error' in r) { failed++; results.push({ ticker: t.ticker, ok: false, error: r.error }); continue; }
      await screenshots.saveVariant(t.id, 'signal', r.signal, 'image/png');
      await screenshots.saveVariant(t.id, 'pixel', r.pixel, 'image/png');
      ok++; results.push({ ticker: t.ticker, ok: true });
    }
    return c.json({ results, captured: ok, failed, skipped: filled.length - stale.length });
  });
```
(`ConflictError` thrown by `capture()` propagates to the existing `errorHandler` → 409.)

- [ ] **Step 6: Delete variants on exit**

Change the `exit` route and the dud-decision→exit path to remove the T1mo variants after exiting. Replace:
```ts
  api.post('/trades/:id/exit', async (c) => {
    const { exitPrice, exitDate } = exitSchema.parse(await c.req.json());
    return c.json(dto(repo.exit(Number(c.req.param('id')), exitPrice, exitDate)));
  });

  api.post('/trades/:id/dud-decision', async (c) => {
    const input = dudDecisionSchema.parse(await c.req.json());
    const id = Number(c.req.param('id'));
    if (input.decision === 'keep') return c.json(dto(repo.dudKeep(id)));
    return c.json(dto(repo.exit(id, input.exitPrice, input.exitDate)));
  });
```
with:
```ts
  const removeT1moVariants = async (id: number) => {
    await screenshots.removeVariant(id, 'signal');
    await screenshots.removeVariant(id, 'pixel');
  };

  api.post('/trades/:id/exit', async (c) => {
    const { exitPrice, exitDate } = exitSchema.parse(await c.req.json());
    const id = Number(c.req.param('id'));
    const out = dto(repo.exit(id, exitPrice, exitDate));
    await removeT1moVariants(id);
    return c.json(out);
  });

  api.post('/trades/:id/dud-decision', async (c) => {
    const input = dudDecisionSchema.parse(await c.req.json());
    const id = Number(c.req.param('id'));
    if (input.decision === 'keep') return c.json(dto(repo.dudKeep(id)));
    const out = dto(repo.exit(id, input.exitPrice, input.exitDate));
    await removeT1moVariants(id);
    return c.json(out);
  });
```

- [ ] **Step 7: Wire the capturer in index.ts**

In `src/server/index.ts` add the import:
```ts
import { createPlaywrightCapturer } from './t1moCapture';
```
After the `screenshots` line:
```ts
const t1moCapturer = createPlaywrightCapturer(process.env);
```
Update `buildApp`:
```ts
const app = buildApp({ repo, now: () => new Date().toISOString(), getNextEarnings, getQuote, screenshots, t1moCapturer });
```

- [ ] **Step 8: Run tests + typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit && npm test
```
Expected: typecheck clean; all tests pass (existing + new capture-route tests).

- [ ] **Step 9: Stage**

```bash
git add src/server/routes.ts src/server/index.ts src/server/routes.test.ts
```

---

## Task 4: Client API helpers

**Files:**
- Modify: `src/client/api.ts`

**Interfaces:**
- Produces:
  ```ts
  t1moThumbUrl(id: number, variant: 'signal' | 'pixel', version: number): string;
  captureT1mo(): Promise<{ results: { ticker: string; ok: boolean; error?: string }[]; captured: number; failed: number; skipped: number }>;
  ```

- [ ] **Step 1: Add the helpers**

In `src/client/api.ts`, inside the `api` object (near `screenshotUrl`):
```ts
  t1moThumbUrl: (id: number, variant: 'signal' | 'pixel', version: number) => `/api/trades/${id}/screenshot?variant=${variant}&v=${version}`,
  captureT1mo: () =>
    fetch('/api/t1mo/capture', { method: 'POST' })
      .then((r) => r.json() as Promise<{ results: { ticker: string; ok: boolean; error?: string }[]; captured: number; failed: number; skipped: number }>),
```

- [ ] **Step 2: Typecheck**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Stage**

```bash
git add src/client/api.ts
```

---

## Task 5: Active Positions — button, T1mo column, thumbnails, lightbox

**Files:**
- Modify: `src/client/components/PlanTables.tsx`

**Interfaces:**
- Consumes: `api.t1moThumbUrl`, `api.captureT1mo` (Task 4); existing `IconButton`, `useToast`, `useState`.
- Produces: flag-gated button + a "T1mo" column with two ≤50×75px thumbnails per row and a lightbox.

Note: the T1mo column is Active-only. `Row`/`HeaderRow` are shared with Pending, so gate the column with a new `showT1mo` prop (only `ActivePositions` passes it). The feature flag `T1MO_CAPTURE` decides whether `ActivePositions` sets `showT1mo`.

- [ ] **Step 1: Add the flag constant and a thumbnail sub-component**

Near the top of `src/client/components/PlanTables.tsx` (after the existing module-level consts like `PRICE_CACHE_MS`):
```tsx
const T1MO_CAPTURE = import.meta.env.VITE_T1MO_CAPTURE === 'true';
```
Add a thumbnail component (above `function Row`):
```tsx
function T1moThumb({ tradeId, variant, version, onOpen }: { tradeId: number; variant: 'signal' | 'pixel'; version: number; onOpen: (url: string) => void }) {
  const [ok, setOk] = useState(true);
  useEffect(() => { setOk(true); }, [version]);
  const url = api.t1moThumbUrl(tradeId, variant, version);
  if (!ok) return <div className="grid h-[50px] w-[75px] place-items-center rounded border border-dashed border-slate-300 text-[9px] uppercase text-slate-400 dark:border-slate-600 dark:text-slate-500">{variant}</div>;
  return (
    <img
      src={url}
      alt={variant}
      title={variant}
      onError={() => setOk(false)}
      onClick={(e) => { e.stopPropagation(); onOpen(url); }}
      className="max-h-[50px] max-w-[75px] cursor-zoom-in rounded border border-slate-200 object-contain dark:border-slate-700"
    />
  );
}
```

- [ ] **Step 2: Add the column to Row/HeaderRow (gated by showT1mo)**

In `HeaderRow`, add the prop and header. Change the signature and the header cells:
```tsx
function HeaderRow({ showHeld, showT1mo }: { showHeld?: boolean; showT1mo?: boolean }) {
```
Add `{showT1mo && <th className={th}>T1mo</th>}` immediately before `<th className={th}>Actions</th>`.

In `Row`, add `showT1mo` and `t1moVersion`/`onLightbox` props to the signature:
```tsx
function Row({ t, children, flagged, warnEarnings, showHeld, livePrice, showT1mo, t1moVersion, onLightbox, onOpen }: { t: TradeDTO; children: React.ReactNode; flagged?: boolean; warnEarnings?: boolean; showHeld?: boolean; livePrice?: number | null; showT1mo?: boolean; t1moVersion?: number; onLightbox?: (url: string) => void; onOpen?: (t: TradeDTO) => void }) {
```
Add the T1mo cell immediately before the actions cell (`<td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>{children}</td>`):
```tsx
      {showT1mo && (
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-1">
            <T1moThumb tradeId={t.id} variant="signal" version={t1moVersion ?? 1} onOpen={onLightbox ?? (() => {})} />
            <T1moThumb tradeId={t.id} variant="pixel" version={t1moVersion ?? 1} onOpen={onLightbox ?? (() => {})} />
          </div>
        </td>
      )}
```

- [ ] **Step 3: Wire state, button, and lightbox into ActivePositions**

In `ActivePositions`, add state near the other `useState` hooks:
```tsx
  const [t1moVersion, setT1moVersion] = useState(1);
  const [t1moBusy, setT1moBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const t1moBusyRef = useRef(false);
  const refreshT1mo = async () => {
    if (t1moBusyRef.current) return;
    t1moBusyRef.current = true;
    setT1moBusy(true);
    try {
      const r = await api.captureT1mo();
      setT1moVersion((v) => v + 1);
      toast(`T1mo: captured ${r.captured}${r.failed ? ` · ${r.failed} failed` : ''}${r.skipped ? ` · ${r.skipped} fresh` : ''}`, r.failed && !r.captured ? 'error' : undefined);
    } catch (err) {
      toast((err as Error)?.message ?? 'T1mo capture failed', 'error');
    } finally {
      t1moBusyRef.current = false;
      setT1moBusy(false);
    }
  };
```
In the toolbar row that holds "Refresh prices" (the `{(filled.data?.length ?? 0) > 0 && (<div className="flex items-center gap-3">…</div>)}` block), add — after the Refresh prices button — a flag-gated button:
```tsx
          {T1MO_CAPTURE && (
            <button
              onClick={() => refreshT1mo()}
              disabled={t1moBusy}
              className="cursor-pointer rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t1moBusy ? 'Capturing T1mo…' : 'Refresh T1mo Signal'}
            </button>
          )}
```
Pass the new props to `HeaderRow`/`Row` in `ActivePositions`:
```tsx
        <HeaderRow showHeld showT1mo={T1MO_CAPTURE} />
```
and on the `<Row ...>`:
```tsx
            <Row key={t.id} t={t} flagged={t.dudFlagged} warnEarnings showHeld livePrice={prices[t.ticker]} showT1mo={T1MO_CAPTURE} t1moVersion={t1moVersion} onLightbox={setLightbox} onOpen={setViewing}>
```
Add the lightbox near the other modals at the end of the `ActivePositions` return:
```tsx
      {lightbox && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="T1mo" className="max-h-[90vh] max-w-[90vw] rounded" />
        </div>
      )}
```

- [ ] **Step 4: Fix the empty-state colSpan for Active**

The Active empty-state row uses `colSpan={7}`. With the T1mo column present it becomes 8 when the flag is on. Change it to:
```tsx
          {filled.data?.length === 0 && <tr><td colSpan={T1MO_CAPTURE ? 8 : 7} className="px-3 py-3 text-slate-500 dark:text-slate-500">No active positions</td></tr>}
```

- [ ] **Step 5: Typecheck + build**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit && npm run build
```
Expected: clean typecheck; build succeeds.

- [ ] **Step 6: Stage**

```bash
git add src/client/components/PlanTables.tsx
```

---

## Task 6: Document env vars + final verification

**Files:**
- Modify: `.env.sample`

- [ ] **Step 1: Add env docs**

Append to `.env.sample` (near the screenshots/price-cache vars):
```
# --- T1mo signal capture (Active Positions "Refresh T1mo Signal" button) ---
# Feature is OFF unless set to exactly "true". Requires Vivaldi installed locally and a
# one-time T1mo login in the automation profile. Captures two clip regions per ticker.
VITE_T1MO_CAPTURE=false
# Clip rectangles on the T1mo chart page, "x,y,w,h" (required when the feature is on).
T1MO_SIGNAL_CLIP=100,200,800,400
T1MO_PIXEL_CLIP=100,620,800,160
# Optional tuning:
T1MO_VIEWPORT=1280,800
T1MO_VIVALDI_PATH=/Applications/Vivaldi.app/Contents/MacOS/Vivaldi
T1MO_USER_DATA_DIR=/tmp/vivaldi-automation-profile
T1MO_CACHE_MINUTES=15
```

- [ ] **Step 2: Full verification**

Run:
```bash
eval "$(mise activate zsh)" && unset NODE_OPTIONS && npx tsc --noEmit && npm test && npm run build
```
Expected: typecheck clean; all tests pass (screenshots variants, t1moCapture logic, capture routes); build succeeds.

- [ ] **Step 3: Stage**

```bash
git add .env.sample
```

---

## Self-Review Notes

- **Spec coverage:** same URL + two configurable clips (Task 2 `parseClip`, env); one global button (Task 5); skip-fresh/capture-stale cache via mtime (Task 1 `ageMs`, Task 3 route); remove on exit (Task 3 step 6); persistent profile (`T1MO_USER_DATA_DIR`, Task 2); feature flag gating client + server (Tasks 3/5, `configError`/null capturer); variant storage `<id>-signal|pixel.webp` (Task 1); thumbnails ≤50×75 + lightbox (Task 5); reuse `VITE_T1MO_URL_TEMPLATE` (Task 2); browser path isolated + untested, everything else tested (Tasks 1–3 tests). All covered.
- **Type consistency:** `T1moCapturer` (`cacheMs`, `configError()`, `capture()`) identical in Tasks 2/3; `CaptureResult` union used the same way; store variant method names match Tasks 1/3; `t1moThumbUrl(id, variant, version)` matches Tasks 4/5; `Deps.t1moCapturer` added Task 3, injected in index + tests.
- **Placeholders:** none — every step has concrete code/tests. Clip values in `.env.sample` are illustrative defaults the user tunes (not plan placeholders).
