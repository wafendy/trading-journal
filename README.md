# Trading Journal

Local single-user trading journal. Vite + React + Hono + SQLite (Drizzle) + Tailwind.

## Requirements
- Node.js 22+ (this repo pins it via mise: `mise install`)

## Setup
    npm install
    cp .env.sample .env   # required — the server loads --env-file=.env and won't start without it
    npm run dev           # client (Vite, :5173) + api (:3000) — Vite proxies /api → :3000

The `.env` file must exist before `npm run dev` / `npm start` (Node's `--env-file`
errors if it's missing). Copy it from `.env.sample`; every variable in it is optional
(see the sample for defaults), so an unedited copy runs fine.

Migrations already exist under `drizzle/`. The app auto-migrates on start, or run
`npm run db:migrate` explicitly. `npm run db:generate` is only needed after changing
`src/server/db/schema.ts`.

## Production
    npm run build
    npm start             # serves built client + api on :3000

Data lives in `trading.db` (gitignored).

## Concepts
- **UPETI** (risk $) and **Confirm-in** (verify days) are global settings, edited in the
  header and snapshotted onto each new trade. Shares = floor(UPETI / (entry − SL)).
- **Mark filled** captures the actual fill date and fill price; realized P&L uses the
  fill price as cost basis: **(exit − fill) × shares** (gross). **R** = P&L / UPETI.
- **Dud check**: a filled position flags red after `verifyDays` weekdays; Keep (stop flagging) or Exit.
- **Year view**: trades attribute to their exit-date year; chart is cumulative P&L.
- **Performance**: the History tab shows overall stat tiles + cumulative equity chart,
  plus a **By buy signal** breakdown table (P&L, R, trades, win rate per signal).
- **Earnings date**: required on the create form; auto-fills from Finnhub after you enter a ticker (optional — see below), and is always manually editable. Shown in the plan tables.
- History uses keyset pagination.

## Earnings auto-fill (optional)
Set `FINNHUB_API_KEY` in `.env` (free key at finnhub.io; `.env.sample` lists it). When creating a plan, the
earnings date auto-fills from Finnhub after you enter a ticker. Without a key the
field simply stays manual — nothing else changes. The seed never calls the API.

## Gmail trade sync (planned — not yet built)
A "Sync now" feature to read broker BOUGHT/SOLD emails from a labeled Gmail folder
and update the ledger (fill pending plans, create positions, exit into history),
with a revertible batch per sync. Read-only OAuth. Design lives at
`docs/superpowers/specs/2026-08-10-gmail-trade-sync-design.md`. Not implemented yet —
setup instructions will be added here when Plan A lands.
