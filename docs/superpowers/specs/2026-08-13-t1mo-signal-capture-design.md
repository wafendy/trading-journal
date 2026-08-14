# T1mo Signal Capture — Design

**Date:** 2026-08-13
**Status:** Approved

## Goal

On demand, capture two screenshots (a "Signal" region and a "Pixel" region) from the
T1mo chart page for each Active Position by driving a local Vivaldi browser via
Playwright/CDP. Show the two thumbnails in each Active Positions row (max 50px tall,
75px wide, Signal on top, Pixel below), click to enlarge. Results are cached 15 minutes
and removed when the position is exited. Local single-user app on macOS; nothing hosted.

## Decisions (from brainstorming)

- **Same URL, two clip regions.** Both screenshots come from the existing T1mo chart URL
  (`VITE_T1MO_URL_TEMPLATE`, `{{TICKER}}` substituted); Signal and Pixel are two fixed
  `clip` rectangles on that page, configurable via env.
- **One global trigger.** A single "Refresh T1mo Signal" button above the Active
  Positions table captures for every active ticker in one Vivaldi session.
- **Cache = skip fresh, capture stale.** On press, a ticker is (re)captured only if its
  screenshots are missing or older than `T1MO_CACHE_MINUTES` (default 15). File mtime is
  the cache timestamp.
- **Removed on exit.** When a position moves filled → exited, its two T1mo snapshots are
  deleted. The manual History chart (`<id>.webp`) is untouched.
- **Persistent login profile.** Vivaldi launches with a persistent `--user-data-dir`, so
  a one-time T1mo login in that profile persists across runs. If not logged in, the
  screenshots will show whatever T1mo serves (e.g. a login page) — accepted.
- **Feature-flagged & config-driven.** Hidden/disabled unless `VITE_T1MO_CAPTURE=true`;
  clip regions and paths are env, tuned without code changes.
- Browser automation is **not** unit-tested (needs a real logged-in browser); it sits
  behind a thin interface so the store, routes, and cache logic are tested without it.

## Non-goals

- No auto-capture on load (on demand only).
- No per-row capture button (global only).
- No editing/annotating captured images; they are read-only (view + lightbox).
- No headless/CI browser support; this targets the user's macOS machine with Vivaldi.
- No change to the manual History chart feature.

## Storage & cache

- Reuse the filesystem screenshot store, extended with a **variant** suffix:
  `screenshots/<id>-signal.webp` and `screenshots/<id>-pixel.webp`. WebP via `sharp`,
  same as the existing chart. The manual chart remains `screenshots/<id>.webp`.
- Store gains variant-aware methods (see Interfaces). The trade `id` remains the only
  link; no schema change.
- Cache: the files themselves. Freshness = `now - mtime < T1MO_CACHE_MINUTES`.

### ScreenshotStore changes
Extend `createScreenshotStore(dir)` return with variant-aware operations. To keep the
existing chart API unchanged, add an optional `variant` argument that suffixes the file:

```ts
type Variant = 'signal' | 'pixel';
// existing (unchanged behavior): key = `${id}.webp`
save(id: number, bytes: Buffer, mimeType: string): Promise<void>;
read(id: number): Promise<Buffer | null>;
remove(id: number): Promise<void>;
// new:
saveVariant(id: number, variant: Variant, bytes: Buffer, mimeType: string): Promise<void>;
readVariant(id: number, variant: Variant): Promise<Buffer | null>;
removeVariant(id: number, variant: Variant): Promise<void>;
ageMs(id: number, variant: Variant): Promise<number | null>; // now - mtime, or null if missing
```

## Capture engine

New `src/server/t1moCapture.ts`. Thin, injectable capture function so routes don't
depend on Playwright directly.

- `interface T1moCapturer { capture(tickers: string[]): Promise<Record<string, CaptureResult>> }`
  where `CaptureResult = { signal: Buffer; pixel: Buffer } | { error: string }`.
- `createPlaywrightCapturer(opts)` implements it:
  1. Read config: URL template, `signalClip`, `pixelClip`, `viewport`, `vivaldiPath`,
     `userDataDir`.
  2. `spawn(vivaldiPath, ['--remote-debugging-port=9222', '--user-data-dir=<dir>'],
     { detached:true, stdio:'ignore' })`; wait ~2s.
  3. `chromium.connectOverCDP('http://localhost:9222')`; reuse
     `context.pages()[0] ?? newPage()`; `setViewportSize(viewport)`.
  4. For each ticker: `page.goto(url, { waitUntil:'networkidle' })`, then two
     `page.screenshot({ clip })` (signal, then pixel). Wrap each ticker in try/catch →
     record `{error}` on failure, continue.
  5. `finally`: `browser.close()`, `vivaldiProcess.kill()`.
- Single-flight: a module-level `inProgress` boolean; a second concurrent call rejects
  with a conflict (the route maps it to 409).
- Port (9222) and the 2s startup delay are constants with a `ponytail:` note; make the
  port an env override if it ever collides.

## Config (server `.env`, documented in `.env.sample`)

- `VITE_T1MO_CAPTURE` — `"true"` enables the feature (client button + server route). Off by default.
- `T1MO_SIGNAL_CLIP` / `T1MO_PIXEL_CLIP` — `"x,y,w,h"` each. Required for capture; if
  unset/invalid the route returns a clear 400.
- `T1MO_VIEWPORT` — `"w,h"`, default `"1280,800"`.
- `T1MO_VIVALDI_PATH` — default `/Applications/Vivaldi.app/Contents/MacOS/Vivaldi`.
- `T1MO_USER_DATA_DIR` — default `/tmp/vivaldi-automation-profile` (persistent login).
- `T1MO_CACHE_MINUTES` — default `15`.
- The capture URL reuses `VITE_T1MO_URL_TEMPLATE` (available to the server because the
  app loads `--env-file=.env`).

## Routes

- `POST /api/t1mo/capture` — Deps gets `t1moCapturer` + `screenshots` + `repo`.
  - 400 if `VITE_T1MO_CAPTURE` is not `"true"` or clip envs are missing/invalid.
  - 409 if a capture run is already in progress.
  - Else: list `filled` trades; select those whose signal/pixel files are missing or
    older than the TTL; call `capturer.capture(staleTickers)`; for each result, either
    `saveVariant` both images or record the error. Map ticker results back to trade ids
    (a ticker may map to multiple filled trades — save to each). Respond
    `{ results: { ticker, ok, error? }[], captured, skipped, failed }`.
- `GET /api/trades/:id/screenshot?variant=signal|pixel` — extend the existing GET: with
  `variant`, serve that file (`readVariant`), else the manual chart (`read`). 404 when
  absent; `Cache-Control: no-store`.
- Exit cleanup: in the `exit` path (`POST /trades/:id/exit` and dud-decision → exit),
  after `repo.exit`, best-effort `removeVariant(id,'signal')` and
  `removeVariant(id,'pixel')`. (The existing cancel/deleteExited cleanup of `<id>.webp`
  stays; those are pending/history and don't have T1mo variants, but calling remove is
  harmless/idempotent.)

## Client (Active Positions)

- **Button:** "Refresh T1mo Signal" next to "Refresh prices", rendered only when
  `import.meta.env.VITE_T1MO_CAPTURE === 'true'`. Single-flight `refreshing` flag +
  `finally` reset (same pattern as prices). On success bump a `t1moVersion` counter to
  cache-bust the thumbnails; toast `Captured N · M failed` (only when a run actually ran).
- **Column:** a new "T1mo" column (only when the flag is on) with two stacked thumbnails
  per row: Signal then Pixel, each `<img src="/api/trades/:id/screenshot?variant=…&v=<n>"
  className="max-h-[50px] max-w-[75px] object-contain"`, `onError` → small placeholder.
  Click → full-size lightbox overlay (click/Esc to close), reusing the details lightbox
  pattern.
- `api.ts`: `t1moThumbUrl(id, variant, version)` and `captureT1mo()` (POST).

## Error handling

- Capture never throws to the client. Per-ticker failures are collected and returned;
  the toast summarizes. Whole-run failures (Vivaldi missing, CDP connect fail) → the
  route still returns 200 with all rows `ok:false` and a top-level `error`, or 500 only
  on truly unexpected faults. The button always re-enables (`finally`).
- Missing config → 400 with a message naming the missing env var.

## Testing

- **Store (unit, temp dir):** `saveVariant` writes `<id>-signal.webp`/`<id>-pixel.webp`
  as valid WebP; `readVariant` returns them / null; `removeVariant` idempotent; `ageMs`
  returns null when missing and a small positive number right after save.
- **Route (unit, injected fake `T1moCapturer`):** with the flag on and clips set, a
  capture run saves both variants for a filled trade and reports `captured`; a capturer
  returning `{error}` yields `ok:false`; flag off → 400; clips unset → 400; a
  second concurrent call → 409 (fake capturer blocks on a latch). Exit removes both
  variant files. `GET …?variant=signal` serves the saved bytes; missing → 404.
- **Not tested:** the real Playwright/Vivaldi path (`createPlaywrightCapturer`) — needs a
  live logged-in browser. Isolated behind `T1moCapturer` so everything else is covered.

## Files touched (anticipated)

- `src/server/screenshots.ts` — add variant methods + `ageMs`.
- `src/server/t1moCapture.ts` (new) — `T1moCapturer` interface + Playwright impl + config parse + single-flight.
- `src/server/routes.ts` — `POST /api/t1mo/capture`, `variant` on the GET, exit cleanup; `Deps` gains `t1moCapturer`.
- `src/server/index.ts` — construct the capturer, pass into `buildApp`.
- `src/server/screenshots.test.ts` — variant tests.
- `src/server/routes.test.ts` — capture-route tests with a fake capturer (node env already set).
- `src/client/api.ts` — `t1moThumbUrl`, `captureT1mo`.
- `src/client/components/PlanTables.tsx` — button, T1mo column, thumbnails, lightbox (flag-gated).
- `.env.sample` — document the new vars.

## Open risks

- **T1mo clip coordinates** are guesses until tuned; env-configurable so the user adjusts
  without code changes. Bad clips → blank/misaligned shots, not crashes.
- **CDP port 9222 collision** if another Chromium debug session is open. Constant for now;
  env override if needed.
- **Playwright browser binaries:** `chromium.connectOverCDP` connects to *Vivaldi*, so
  Playwright's bundled Chromium download is not required — but `playwright` must be
  installed (it is). No `playwright install` step needed for CDP-connect.
