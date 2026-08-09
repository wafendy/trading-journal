# Trading Journal

Local single-user trading journal. Vite + React + Hono + SQLite (Drizzle) + Tailwind.

## Requirements
- Node.js 22+ (this repo pins it via mise: `mise install`)

## Setup
    npm install
    npm run dev           # client (Vite, :5173) + api (:3000) — Vite proxies /api → :3000

Migrations already exist under `drizzle/`. The app auto-migrates on start, or run
`npm run db:migrate` explicitly. `npm run db:generate` is only needed after changing
`src/server/db/schema.ts`.

## Production
    npm run build
    npm start             # serves built client + api on :3000

Data lives in `trading.db` (gitignored).

## Concepts
- **UPETI**: risk amount ($). Shares = floor(UPETI / (entry − SL)).
- **Realized P&L** = (exit − entry) × shares (gross). **R** = P&L / UPETI.
- **Dud check**: a filled position flags red after `verifyDays` weekdays; Keep (stop flagging) or Exit.
- **Year view**: trades attribute to their exit-date year; chart is cumulative P&L.
- **Earnings date**: entered manually on the create form (required); shown in the plan tables. No external data fetch.
- History uses keyset pagination.
