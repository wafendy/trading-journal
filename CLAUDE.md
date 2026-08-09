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

    eval "$(mise activate zsh)" && npm run dev          # client (Vite :5173) + server (:3000), Vite proxies /api
    eval "$(mise activate zsh)" && npm test              # vitest run
    eval "$(mise activate zsh)" && npx tsc --noEmit       # typecheck only
    eval "$(mise activate zsh)" && npm run build          # tsc -b && vite build
    eval "$(mise activate zsh)" && npm start              # prod: serves built client + api on :3000
    eval "$(mise activate zsh)" && npm run db:generate    # after changing src/server/db/schema.ts
    eval "$(mise activate zsh)" && npm run db:migrate     # apply migrations (app also auto-migrates on start)

## Architecture

- `src/lib/` — shared types (`types.ts`) and calc functions (`calc.ts`). This is the
  single source of truth for money math and is imported by BOTH server and client.
  Change it in one place; do not duplicate calculation logic elsewhere.
- `src/server/` — `db/schema.ts` + `db/index.ts` (Drizzle/SQLite), `repository.ts`
  (data access), `validation.ts` (Zod schemas), `routes.ts` (Hono routes), `app.ts`
  (app factory), `index.ts` (entry point, node-server + static serving).
- `src/client/` — `api.ts` (fetch wrappers), `components/`, `App.tsx` (composition root).

## Key domain rules

- **UPETI** = risk amount in dollars.
- **shares** = `floor(upeti / (entry − sl))`.
- **realizedPnl** = `(exit − entry) × shares` (gross, no fees).
- **R** = `pnl / upeti`.
- **Dud flag**: a filled position with no decision flags as a dud once
  `weekdaysBetween(fillDate, today) >= verifyDays`.
- **Year attribution**: trades are attributed to the year of their `exit_date`, not
  entry date. No cross-year aggregation.
- **History pagination** uses keyset (cursor) pagination with a **composite** cursor
  of the form `"<exitDate>|<id>"` — NOT an id-only cursor. Exit dates repeat across
  rows, so an id-only cursor drops or duplicates rows when sorting by exit date; the
  composite key is required for correct ordering and stability.
- **Earnings date** is entered **manually** on the create form (required field) and is
  editable via PATCH. There is deliberately **no** external earnings API/scrape —
  do not add one without being asked.

## Testing

`calc`, `validation`, `repository`, and `routes` each have vitest test files
(`*.test.ts` next to the source). The UI (`src/client/`) is not unit-tested. Run with
the mise prefix shown above; `npm test` runs the full suite via `vitest run`.
