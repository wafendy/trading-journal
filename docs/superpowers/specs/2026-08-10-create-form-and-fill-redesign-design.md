# Create-Form & Fill Redesign — Design Spec

**Date:** 2026-08-10
**Status:** Approved (design)

## Goal

Reshape the trade-planning workflow around three ideas:

1. **A tighter 3-column create form** — Ticker first, Earnings Date beside it. No entry
   date, no UPETI, no Confirm-in on the form.
2. **UPETI and Confirm-in (verify days) become global settings**, edited in the app
   header, copied into each new trade as a snapshot.
3. **The actual fill (date + price) is captured when marking an order filled**, via a
   modal. The actual fill price becomes the P&L cost basis.

## Background (current state)

- `trades` has `entry_date` (`NOT NULL`, set at create, may be future) **and** `fill_date`
  (nullable, set by the one-click "Mark filled", hardcoded to today). The dud-check runs
  off `fill_date`; `entry_date` is only shown as supplementary text under the entry price.
- Money math (`src/lib/calc.ts`): `shares = floor(upeti/(entryPrice − slPrice))`,
  `realizedPnl = (exitPrice − entryPrice) × shares`, `R = realizedPnl / upeti`.
- `app_settings` is a key/value table holding only `last_upeti`, used as a **prefill
  default** on the create form. There is no settings UI. `verify_days` is per-trade only.
- `entry_date` is displayed in `PlanTables.tsx`, `HistoryTable.tsx`, `TradeDetails.tsx`.

## Decisions

- **Single date.** Entry date and fill date are the same event. Drop `entry_date`
  entirely; `fill_date` is *the* date. A pending plan has no date until filled.
- **New `fill_price`.** Actual fill price, captured at fill time, required in the modal,
  defaults to the planned entry price. Null while pending.
- **Fill price replaces entry for P&L.** Shares stay sized at creation from the *planned*
  `entryPrice`. Once filled, `realizedPnl = (exitPrice − fillPrice) × shares`.
- **Per-trade snapshots.** `upeti` and `verify_days` remain per-trade columns, copied
  from the globals at create time. Changing a global never rewrites existing trades'
  shares or R.

---

## Section 1 — Data model

### Schema (`src/server/db/schema.ts`)

- **Remove** `entryDate: text('entry_date').notNull()`.
- **Add** `fillPrice: real('fill_price')` (nullable).
- `upeti`, `verifyDays` unchanged (stay per-trade).

### Migration (`drizzle/`)

New migration (next sequential number, generated via `npm run db:generate` after editing
schema) that:
- Drops column `entry_date`.
- Adds column `fill_price REAL` (nullable).

SQLite drop-column is supported by Drizzle's generated migration; the app auto-migrates on
start. Existing local `trading.db` rows lose `entry_date`; any already-filled rows get
`fill_price = NULL` (acceptable — this is a local single-user journal; a follow-up could
backfill `fill_price = entry_price` for filled/exited rows, see Non-goals / follow-ups).

### Types (`src/lib/types.ts`)

- `TradeRow`: remove `entryDate: string`; add `fillPrice: number | null`.
- `TradeDTO` unchanged in shape (still extends `TradeRow` with derived fields).

### Calc (`src/lib/calc.ts`)

- `computeShares(upeti, entryPrice, slPrice)` — **unchanged** (sizes from planned entry).
- `computePnl` — **unchanged signature** `(cost, exit, shares)`; caller changes.
- `deriveTrade`:
  - `shares` from `row.entryPrice` (unchanged).
  - `realizedPnl`: cost basis is `row.fillPrice` when present, else `row.entryPrice`
    (fallback keeps historical/migrated rows sane). Exited rows always have a fill price
    going forward.
  - `rMultiple` unchanged (`pnl / upeti`).

---

## Section 2 — Global settings (UPETI + Confirm-in)

### Storage (`app_settings`)

Extend the key/value table with two keys: `upeti` and `verify_days`. Keep `last_upeti`
usage removed/replaced by `upeti` (single source of truth for the default).

### Repository (`src/server/repository.ts`)

Replace `getLastUpeti`/`setLastUpeti` with a small settings accessor:

- `getSettings(): { upeti: number; verifyDays: number }` — reads both keys, falling back
  to defaults **UPETI 100**, **verifyDays 5** when unset.
- `setSettings(partial: { upeti?: number; verifyDays?: number }): void` — upserts the
  provided keys.

`create()` no longer calls `setLastUpeti`. It receives `upeti` and `verifyDays` in its
input (copied from globals by the client) and snapshots them as today.

### API (`src/server/routes.ts`, `src/server/validation.ts`)

- `GET /api/settings` → `{ upeti: number, verifyDays: number }` (replaces the
  `{ lastUpeti }` shape).
- `PATCH /api/settings` → body `{ upeti?: number, verifyDays?: number }`, validated by a
  new `settingsSchema` (`upeti` positive number; `verifyDays` ∈ {5,7,10,14}); returns the
  full updated settings.

### Client

- `src/client/api.ts`: `settings()` returns the new shape; add
  `updateSettings(body): Promise<{ upeti, verifyDays }>`.
- **Header controls** (in the app header/toolbar, likely `App.tsx` or a new
  `SettingsControls.tsx`): a small UPETI number input and a Confirm-in `<select>`
  (5/7/10/14). Editing either calls `PATCH /api/settings` and invalidates the `['settings']`
  query. These are always visible.
- The create form reads `settings` and copies `upeti` + `verifyDays` into the create
  payload; it does **not** render inputs for them.

---

## Section 3 — Create form layout (`src/client/components/TradeForm.tsx`)

3-column grid:

```
┌──────────────┬───────────────┬──────────────────┐
│ Ticker       │ Earnings Date │ (blank)          │
├──────────────┼───────────────┼──────────────────┤
│ Entry Signal │ Entry Type    │ (blank)          │
├──────────────┼───────────────┼──────────────────┤
│ Entry Price  │ SL Price      │ TP Price (opt.)  │
├──────────────┴───────────────┴──────────────────┤
│ Notes (full width)                               │
└──────────────────────────────────────────────────┘
Position size: N shares    Risk/Reward: 1 : X.XX
```

Changes from today:
- Grid becomes `grid-cols-3`.
- **Ticker** is the first field; **Earnings Date** beside it (keeps ticker-blur auto-fill
  and the manual-edit-wins behavior).
- **Remove** the Entry date field entirely.
- **Remove** the UPETI and Confirm-in (Verify in) fields.
- Rows 1–2 have an empty third cell (`<div />` spacer) to preserve alignment.
- Entry Price / SL Price / TP Price share row 3.
- Notes spans all three columns.
- Position-size + Risk/Reward summary stays. Shares still computed from UPETI (now from
  global settings) + entry + SL.
- Validity: `ticker && upeti>0 && entry>sl && sl>0 && earningsDate && !slError && !tpError
  && !earningsDateError`. (Entry-date validation removed.) UPETI comes from settings, so it
  is effectively always > 0.

---

## Section 4 — Mark-filled modal

### UI (`src/client/components/PlanTables.tsx` + a fill modal)

Clicking **Mark filled** on a pending row opens a small modal (reuse the existing `Modal`
from `ExitForm.tsx`) with:
- **Fill date** — date picker, defaults to today.
- **Fill price** — number, **required**, defaults to the planned entry price.
- **Confirm** / **Cancel**.

Confirm calls the fill mutation with `{ fillDate, fillPrice }`.

### API / repo / validation

- `fillSchema` gains `fillPrice: z.number().positive()` →
  `{ fillDate: isoDate, fillPrice }`.
- `repo.fill(id, fillDate, fillPrice)` sets `status='filled'`, `fillDate`, `fillPrice`.
- `POST /api/trades/:id/fill` passes both through.
- `api.fill(id, fillDate, fillPrice)` on the client.

The dud-check is unchanged (runs off `fill_date`).

---

## Ripple effects (in scope)

- **PlanTables / HistoryTable**: the `{t.entryDate}` line under entry price → show
  `fillDate ?? '—'`. For filled/exited rows, also surface `fillPrice` (e.g. under entry
  price show "filled @ <fillPrice>"). Exact placement is an implementation nicety.
- **TradeDetails**: replace the `Entry … (entryDate)` row with entry price + a Fill row
  (`fillPrice` @ `fillDate`) when filled.
- **Seed (`src/server/seed.ts`)**: drop `entryDate` from plan seeds; `repo.fill` calls pass
  a `fillPrice` (use the plan's `entryPrice`, or a slight offset for realism). Settings seed
  writes `upeti`/`verify_days` if desired.
- **Tests**: `repository.test.ts`, `routes.test.ts`, `calc.test.ts`, `validation.test.ts`
  updated for the new fill signature, settings shape, dropped `entryDate`, and P&L cost
  basis.

## Testing strategy

- `calc.test.ts`: `deriveTrade` uses `fillPrice` as cost basis when present; falls back to
  `entryPrice` when null; shares still from planned entry.
- `validation.test.ts`: `fillSchema` requires positive `fillPrice`; `settingsSchema`
  accepts partials and rejects bad `verifyDays`.
- `repository.test.ts`: `fill` persists `fillPrice`; `getSettings`/`setSettings` round-trip
  with defaults.
- `routes.test.ts`: `GET/PATCH /api/settings`; `POST /fill` with fillPrice; create payload
  no longer includes `entryDate`.
- UI (`src/client/`) remains unit-untested per project convention; verify by build + manual.

## Non-goals / follow-ups

- No backfill of `fill_price` for pre-existing filled rows (fallback to `entryPrice` in
  calc covers correctness). A one-off backfill could be added later.
- No history/analytics changes beyond the cost-basis fix.
- No change to earnings auto-fill behavior.
