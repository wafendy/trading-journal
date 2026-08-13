# Trade Chart Screenshots — Design

**Date:** 2026-08-13
**Status:** Approved

## Goal

Let the user attach one chart screenshot (a T1mo chart) per trade. Screenshots are
captured on macOS as PNG, pasted or uploaded in the app, and shown as a thumbnail that
enlarges on click. This is a local single-user app served from `localhost`; images are
never exposed to the internet.

## Decisions (from brainstorming)

- **One screenshot per trade.** No gallery.
- **Storage: filesystem folder**, not a SQLite BLOB and not a path column. The trade's
  integer `id` is the only link — given a trade, the server knows the file is
  `screenshots/<id>.webp`. No schema change.
- **Auto-convert to WebP on upload.** macOS screenshots are PNG (often 1–4 MB at Retina);
  re-encoding to WebP q85 yields ~80–90% smaller files and, crucially, a **fixed
  extension** so the server never has to glob for `<id>.*`.
- **Editing lives in the History table** via a dedicated **Chart** CTA that is
  **always available** — independent of `VITE_ALLOW_HISTORY_EDIT`. (That flag continues
  to gate only the Edit/Delete row actions.)
- **The trade details modal shows the chart read-only** (thumbnail, click to enlarge),
  wherever details are opened (all tabs).
- Backup portability of images is explicitly **not** a concern.

## Non-goals

- No multi-image galleries, captions, or annotations.
- No image editing/cropping in-app.
- No inclusion of screenshots in the `db:backup` artifact (DB-only backup is unchanged).
- No change to trade `id` type (stays integer).

## Storage & server

### Location
- Directory `./screenshots/` next to `trading.db`, overridable via a `SCREENSHOTS_DIR`
  env var. Created on demand (`mkdir -p`) on first write.
- Gitignored (add `screenshots/` to `.gitignore`).
- One file per trade: **`screenshots/<id>.webp`** — always `.webp` because uploads are
  re-encoded.

### Dependency
- Add **`sharp`** for WebP encoding. It's a native module, consistent with the existing
  `better-sqlite3` native dependency and the mise-pinned Node 22 toolchain.

### Routes
All keyed by the trade `id`. Validation reuses the existing ticker/id patterns and the
repository's `getById`/NotFound conventions.

- **`POST /api/trades/:id/screenshot`**
  - 404 if the trade does not exist.
  - Accepts a multipart file upload; content type must be `image/png`, `image/jpeg`, or
    `image/webp`; size ≤ 10 MB → otherwise **400**.
  - Re-encodes to WebP (`sharp(bytes).webp({ quality: 85 })`), writes
    `screenshots/<id>.webp`, overwriting any existing file. Returns 204.
- **`GET /api/trades/:id/screenshot`**
  - Streams `screenshots/<id>.webp` with `Content-Type: image/webp` and
    `Cache-Control: no-store` (so a replaced image shows immediately).
  - **404** when no file exists (the client uses this to show its placeholder).
- **`DELETE /api/trades/:id/screenshot`**
  - Removes the file if present (idempotent). Returns 204.

### Orphan cleanup
- On trade delete (`deleteExited`) and cancel (`cancel`), best-effort delete the trade's
  `<id>.webp` so the folder doesn't accumulate orphans. Failure to delete the image must
  not fail the trade operation.

### Injection / testability
- File I/O and WebP encoding are side-effectful, so this logic is exercised via route
  tests against a temporary `SCREENSHOTS_DIR`. `sharp` runs for real in tests using a
  tiny fixture image buffer.

## Client UI

### History table — Chart CTA (always on)
- A new, always-present column/action in the Trading History table with a **Chart**
  button (small chart/image icon). It renders regardless of `VITE_ALLOW_HISTORY_EDIT`.
- The existing Edit/Delete actions remain behind `VITE_ALLOW_HISTORY_EDIT` and are
  unaffected.
- Clicking **Chart** opens the **Chart modal** for that trade.
- The empty-state `colSpan` and header are updated to account for the new column.

### Chart modal (view + edit)
- Displays the current image via `<img src="/api/trades/:id/screenshot?v=<n>">`. If the
  request 404s, an `onError` handler swaps in a **placeholder** ("No chart attached").
- **Upload / paste area:** click to choose a file (file input), or paste a clipboard
  image with Cmd+V (`onPaste` reading `clipboardData.files`/items). On selection →
  `POST` the file → on success bump the `v` counter to force the `<img>` to reload
  (responses are `no-store`).
- **Remove** button when an image exists → `DELETE` → bump `v`.
- Basic client-side guard: reject non-image or > 10 MB before POST with a toast; the
  server enforces the same limits authoritatively.

### Details modal (read-only chart)
- Add a **Chart** area to `TradeDetails` showing the thumbnail (`<img>` with the same
  404→placeholder behavior). Clicking a present thumbnail opens a lightweight full-size
  lightbox overlay (click / Esc to close). No upload controls here.

### Client API + state
- `api.screenshotUrl(id, v)` → the GET URL with cache-busting param.
- `api.uploadScreenshot(id, file)` → POST (multipart).
- `api.deleteScreenshot(id)` → DELETE.
- No React Query cache entry for the image bytes; the `<img src>` + a per-view version
  counter is the whole mechanism.

## Testing

- **Routes (temp `SCREENSHOTS_DIR`):**
  - Upload a small PNG fixture → 204; file `<id>.webp` exists and is valid WebP.
  - `GET` after upload → 200, `Content-Type: image/webp`.
  - `GET` with no file → 404.
  - `DELETE` → 204 and file gone; second `DELETE` still 204 (idempotent).
  - Upload to a nonexistent trade id → 404.
  - Upload a non-image / oversize payload → 400.
- **Cleanup:** deleting an exited trade removes its `<id>.webp`.
- UI (`src/client/`) remains unit-untested per existing repo convention.

## Files touched (anticipated)

- `src/server/screenshots.ts` (new) — WebP encode + file read/write/delete helpers,
  parameterized by directory for testability.
- `src/server/routes.ts` — three routes + orphan cleanup in delete/cancel. Reads the
  screenshots store from `Deps` (a new `screenshots` field on the `Deps` interface,
  following the existing `getNextEarnings`/`getQuote` injection pattern).
- `src/server/index.ts` — construct the screenshots store from `SCREENSHOTS_DIR`
  (default `./screenshots`) and pass it in `buildApp({ ..., screenshots })`.
- `src/server/routes.test.ts` setup — provide a temp-dir-backed screenshots store,
  mirroring how it already stubs `getNextEarnings`/`getQuote`.
- `src/client/api.ts` — url/upload/delete helpers.
- `src/client/components/ChartModal.tsx` (new) — view + upload/paste + remove.
- `src/client/components/HistoryTable.tsx` — always-on Chart CTA column + modal wiring.
- `src/client/components/TradeDetails.tsx` — read-only chart thumbnail + lightbox.
- `.gitignore` — add `screenshots/`.
- `package.json` — add `sharp`.
- `src/server/routes.test.ts` (or a new `screenshots.test.ts`) — route tests.

## Open risks

- **`sharp` install** is a native build; must install cleanly under mise Node 22. If it
  proves troublesome, fallback is storing the original PNG bytes as `<id>.png` with no
  conversion (loses the size/fixed-extension benefit) — but this is not expected.
