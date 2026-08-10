# CLAUDE.md

Guidance for AI coding agents working in this repo.

## Project

Local single-user trading journal. Vite + React + TypeScript client, Hono API server,
SQLite via Drizzle ORM, Tailwind v4 for styling.

## Dev environment — read this first

Node is provided via **mise** (pinned to Node 22 in `mise.toml`), not a system install.
A plain non-login shell (including most agent/CI shells) will NOT have `node`/`npm`/`npx`
on PATH. Prefix every node-based command with:

    eval "$(mise activate zsh)" && <command>

or run it via `mise exec -- <command>`. This is the #1 gotcha in this repo — commands
that "should work" fail with `command not found: node` if you forget this.

## Commands

`npm run dev`/`npm start` load `--env-file=.env` and **fail if `.env` is missing** —
`cp .env.sample .env` first (all vars in it are optional; see `.env.sample`).

    eval "$(mise activate zsh)" && npm run dev          # client (Vite :5173) + server (:3000), Vite proxies /api
    eval "$(mise activate zsh)" && npm test              # vitest run
    eval "$(mise activate zsh)" && npx tsc --noEmit       # typecheck only
    eval "$(mise activate zsh)" && npm run build          # tsc -b && vite build
    eval "$(mise activate zsh)" && npm start              # prod: serves built client + api on :3000
    eval "$(mise activate zsh)" && npm run db:generate    # after changing src/server/db/schema.ts
    eval "$(mise activate zsh)" && npm run db:migrate     # apply migrations (app also auto-migrates on start)

## Git workflow

Everything is kept **staged but uncommitted** — after finishing a change run
`git add -A` to stage only. Do **not** `git commit` anything (app code, docs, or
specs) unless the user explicitly asks. Leave `bun.lock` alone (do not stage it).

## Architecture

- `src/lib/` — shared types (`types.ts`) and calc functions (`calc.ts`). This is the
  single source of truth for money math and is imported by BOTH server and client.
  Change it in one place; do not duplicate calculation logic elsewhere.
- `src/server/` — `db/schema.ts` + `db/index.ts` (Drizzle/SQLite), `repository.ts`
  (data access), `validation.ts` (Zod schemas), `routes.ts` (Hono routes), `app.ts`
  (app factory), `index.ts` (entry point, node-server + static serving).
- `src/client/` — `api.ts` (fetch wrappers), `components/`, `App.tsx` (composition root).
- Earnings lookup: `src/server/earnings.ts` (Finnhub provider, injected via `Deps.getNextEarnings`; returns null without `FINNHUB_API_KEY` and never throws). Route `GET /api/earnings?ticker=`. Client auto-fills on ticker blur in `TradeForm` (manual edit always wins). The seed sets earnings dates directly and never calls the API.
- Global settings: `app_settings` key-value table holds `upeti` and `verify_days`; `GET`/`PATCH /api/settings` (`repo.getSettings`/`setSettings`, defaults UPETI 100 / verifyDays 5). Edited via `SettingsControls` in the header; copied onto each new trade at creation.
- Fill capture: "Mark filled" opens `FillModal` (fill date + required fill price, defaults to planned entry) → `POST /api/trades/:id/fill` with `{ fillDate, fillPrice }`.
- History analytics: `GET /api/summary?year=` returns overall totals + `equityCurve` + `bySignal` (per-signal P&L/R/count/win-rate, signals with ≥1 exited trade). Rendered by `StatTiles`, `EquityChart` (overall cumulative curve only), and `SignalBreakdown` (table). All P&L in the route uses one `pnlOf` helper (cost basis `fillPrice ?? entryPrice`).

## Key domain rules

- **UPETI** = risk amount in dollars; a global setting (in `app_settings`) snapshotted per trade at creation. Changing it never rewrites existing trades.
- **shares** = `floor(upeti / (entry − sl))`, sized at creation from the planned entry price.
- **realizedPnl** = `(exit − fillPrice) × shares` (gross, no fees); `fillPrice` is captured at Mark-filled and falls back to `entryPrice` if absent.
- **R** = `pnl / upeti`.
- **There is a single trade date**: `fill_date`, set at Mark-filled (which also captures `fill_price`). There is no separate entry date; a pending plan has no date.
- **verifyDays / Confirm-in**: a global setting snapshotted per trade.
- **Dud flag**: a filled position with no decision flags as a dud once
  `weekdaysBetween(fillDate, today) >= verifyDays`.
- **Year attribution**: trades are attributed to the year of their `exit_date`, not
  entry date. No cross-year aggregation.
- **History pagination** uses keyset (cursor) pagination with a **composite** cursor
  of the form `"<exitDate>|<id>"` — NOT an id-only cursor. Exit dates repeat across
  rows, so an id-only cursor drops or duplicates rows when sorting by exit date; the
  composite key is required for correct ordering and stability.
- **Earnings date** is a required field on the create form and editable via PATCH. It
  auto-fills from Finnhub on ticker blur (see the earnings-lookup note above) but a
  manual edit always wins; without `FINNHUB_API_KEY` the field simply stays manual.

## Testing

`calc`, `validation`, `repository`, and `routes` each have vitest test files
(`*.test.ts` next to the source). The UI (`src/client/`) is not unit-tested. Run with
the mise prefix shown above; `npm test` runs the full suite via `vitest run`.
