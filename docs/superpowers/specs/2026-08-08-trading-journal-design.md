# Trading Journal — Design Spec

**Date:** 2026-08-08
**Status:** Approved

## Overview

A local, single-user web app to track US stock trading activity. No authentication
(runs locally on the user's MacBook). One dashboard shows the current trading plan
(pending orders + active positions), a paginated trading history with infinite
scroll, and a per-year performance summary with a cumulative equity curve.

## Stack

- **Vite** (React + TypeScript) — client
- **Hono** (`@hono/node-server`) — API server; serves the built client in production
- **SQLite** (`better-sqlite3`) + **Drizzle ORM** + Drizzle Kit migrations
- **Tailwind CSS** — styling
- **TanStack Query** — data fetching, caching, infinite scroll, optimistic updates
- **Recharts** — cumulative equity curve
- **Zod** — request validation + shared types
- **Vitest** — tests

Latest stable version of each package.

## Architecture (Option A — single app)

One `package.json`, one repo. Hono exposes `/api/*`. In dev, the Vite dev server
runs the client and proxies `/api` to Hono (`tsx watch`). In production, `vite build`
produces static assets that Hono serves alongside the API. Single SQLite file
`trading.db` (gitignored).

Money math lives in a shared `src/lib/calc.ts` imported by **both** server and client
(server computes derived fields for responses; client uses it for live form previews).
Single source of truth for all calculations.

### Project structure

```
trading-journal/
  src/
    server/        # Hono app, routes, db (Drizzle schema, migrations wiring)
    client/        # React app (components, hooks, pages)
    lib/calc.ts    # shared money math — imported by server & client
  drizzle/         # generated migrations
  trading.db       # local SQLite (gitignored)
  index.html, vite.config.ts, tailwind.config.*, package.json
```

## Domain concepts

### UPETI
UPETI is the **risk amount** in USD — the dollars the user is willing to lose on a
trade. It sizes the position. The last UPETI entered is remembered and pre-filled
into the create form.

### Trade lifecycle
A single trade row moves through states:

`pending` → `filled` → `exited`

- **pending** — a plan / pending order (Buy Limit or Buy Stop) not yet filled.
- **filled** — position entered; the dud-signal verification clock starts at `fill_date`.
- **exited** — closed; realized P&L is computed. Exited rows are the "history".

A `pending` order can be **cancelled** → hard-deleted (never enters history).
Cancel is only valid on `pending`; exit is only valid on `filled`.

## Data model

### Table: `trades`

| column | type | notes |
|---|---|---|
| `id` | integer PK autoincrement | |
| `ticker` | text | US stock symbol, stored uppercased |
| `upeti` | real | risk amount ($) at creation |
| `entry_price` | real | |
| `sl_price` | real | required; sizes the position |
| `tp_price` | real \| null | optional |
| `entry_type` | text | `buy_limit` \| `buy_stop` |
| `entry_signal` | text | `btb` \| `buy_lautan` \| `buy_magenta` \| `hawk1` \| `buy_spec` |
| `entry_date` | text (ISO `YYYY-MM-DD`) | default today, editable |
| `verify_days` | integer | 5 \| 7 \| 10 \| 14 |
| `status` | text | `pending` \| `filled` \| `exited` |
| `fill_date` | text (ISO) \| null | set when marked filled; dud-clock start |
| `dud_decision` | text \| null | null \| `keep` \| `exit`; once `keep`, never flag again |
| `exit_price` | real \| null | |
| `exit_date` | text (ISO) \| null | default today at exit, editable |
| `created_at` | text (ISO datetime) | |
| `updated_at` | text (ISO datetime) | |

Only raw inputs are stored. All P&L / R / flags are derived.

### Table: `app_settings`

Key-value. Holds `last_upeti` (string-encoded real) used to prefill the create form.

## Derived calculations (`src/lib/calc.ts`)

- `shares = floor(upeti / (entry_price − sl_price))`
- `realized_pnl = (exit_price − entry_price) × shares` — gross USD, no fees
- `r_multiple = realized_pnl / upeti`
- **Dud flag** (only `status === 'filled'` and `dud_decision === null`):
  flagged when `weekdaysBetween(fill_date, today) >= verify_days`.
  - `weekdaysBetween` counts calendar weekdays (Mon–Fri), skipping weekends.
    US market holidays are NOT considered.
- **Year attribution:** a trade belongs to the year of its **`exit_date`**
  (P&L realizes at exit). Pending/filled trades have no year.

### Entry-signal pill colors (consistent everywhere)

| signal | color |
|---|---|
| BTB (`btb`) | green (normal) |
| Buy Lautan (`buy_lautan`) | light blue |
| Buy Magenta (`buy_magenta`) | magenta |
| Hawk1 (`hawk1`) | dark green |
| Buy Spec (`buy_spec`) | pink |

## API surface (Hono, JSON, under `/api`)

Derived fields (shares, realized_pnl, r_multiple, dud flag) are computed server-side
and included in responses.

| method + path | purpose |
|---|---|
| `GET /api/trades?status=pending\|filled` | Open rows for the top area (no pagination — small set). |
| `GET /api/trades/history?year=<y>&cursor=<id>&limit=50` | Exited rows for a year, newest first, keyset pagination (cursor = last seen id). Returns `{ items, nextCursor }`. |
| `GET /api/years` | Distinct years present in exited trades (drives year selector). |
| `GET /api/summary?year=<y>` | `{ totalPnl, totalR, tradeCount, winRate, equityCurve: [{ exitDate, cumulativePnl }] }` ordered by exit date. |
| `POST /api/trades` | Create plan (status `pending`). Zod-validated. Also updates `last_upeti`. |
| `PATCH /api/trades/:id` | Edit fields (entry date, prices, SL/TP, verify_days, etc.). |
| `POST /api/trades/:id/fill` | Mark filled; `{ fillDate }` (default today). Only valid from `pending`. |
| `POST /api/trades/:id/cancel` | Cancel a `pending` order → hard delete. Only valid from `pending`. |
| `POST /api/trades/:id/dud-decision` | `{ decision: 'keep' \| 'exit', exitPrice?, exitDate? }`. `keep` stops flagging; `exit` sets `exited` + exit fields. Only valid from `filled`. |
| `POST /api/trades/:id/exit` | Normal exit `{ exitPrice, exitDate }` → `exited`. Only valid from `filled`. |
| `GET /api/settings` | `{ lastUpeti }` for form prefill. |

### Validation & errors
- Zod schema per endpoint; invalid input → `400` with field-level messages.
- State-transition guards → `409` with a clear message (e.g. can't exit a pending
  order, can't cancel a filled one).
- Keyset pagination (not offset) so infinite scroll stays correct as rows change.

## UI layout & interactions

Single-page dashboard, top → bottom:

1. **Header bar** — app title, **Year selector** (segmented control; only years from
   `GET /api/years`; defaults to latest), and **"+ New Trade Plan"** button (opens modal).

2. **Yearly summary** (reacts to selected year) — stat tiles: **Total Realized P&L**
   ($, green/red), **Total R**, **Trade count**, **Win rate**; plus a **cumulative
   equity curve** (Recharts, x = exit date, y = cumulative P&L, zero line marked).

3. **Current Trading Plan** — two sub-sections:
   - **Pending Orders** — `Pending` pill; actions: **Mark Filled**, **Cancel**, **Edit**.
   - **Active Positions** (filled) — actions: **Exit**, **Edit**. Rows past their verify
     window with no decision get a **red highlight + "Verify" badge** and inline
     **Keep** / **Exit** controls. `Keep` clears the flag forever; `Exit` opens the
     exit form.

4. **Trading History** — table of exited rows for the selected year, newest first,
   **infinite scroll** (TanStack `useInfiniteQuery` + intersection-observer sentinel,
   50 per page). Columns: Ticker, Entry date, Entry price, SL, TP, Exit date,
   Exit price, Entry signal (colored pill), **Realized P&L** ($ + R).

### Forms (modal dialogs)
- **Create:** Ticker, UPETI (prefilled with last value), Entry price, SL (required),
  TP (optional), Entry type (Buy Limit / Buy Stop), Entry signal (pill picker),
  Entry date (default today), Verify-in days dropdown (5/7/10/14). Live-computed
  preview of shares + risk using `lib/calc.ts`.
- **Exit:** exit price + exit date (default today).

### Reminder behavior
Flag-on-open only (no OS/browser notifications). The red highlight + Verify badge
persists on every load until the user picks Keep or Exit. `Keep` sets `dud_decision`
and the row is never flagged again.

All mutations use optimistic updates + query invalidation so tables and the yearly
summary stay in sync.

## Testing (TDD)

Priority order:

1. **`src/lib/calc.ts` unit tests (Vitest)** — the correctness core:
   - share flooring (fractional → floor)
   - gross P&L sign (win/loss)
   - R-multiple
   - `weekdaysBetween` and dud-flag boundary (exactly N vs N−1 weekdays; weekend skipping)
   - year attribution by exit date
   - keyset cursor helper
2. **API integration tests** — in-memory SQLite:
   - create → fill → exit lifecycle
   - cancel deletes a pending order; cancel/exit guards return 409
   - history pagination + year filter (newest first, cursor correctness)
   - summary aggregation (totals, win rate, equity curve ordering)
3. **UI** — light. One smoke test that the dashboard renders. Not heavily tested
   (local single-user app).

## Tooling

TypeScript strict mode, Zod (shared types via `z.infer`), ESLint + Prettier,
Drizzle Kit migrations.

## Out of scope (YAGNI)

- Authentication / multi-user
- Commissions / fees (gross P&L only)
- US market holiday calendar (weekends only)
- Cross-year aggregation
- Order-fill automation / broker integration
- OS/browser push notifications
