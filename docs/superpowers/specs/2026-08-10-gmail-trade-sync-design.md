# Gmail → Ledger Sync — Design Spec (refreshed)

**Date:** 2026-08-10
**Status:** Approved (design)
**Supersedes:** `2026-08-09-gmail-trade-sync-design.md` (written before the create-form
& fill redesign; that spec references dropped/changed fields — `entry_date`,
`getLastUpeti`, `computeShares`-only sizing. This version reconciles with the
current data model: single `fill_date`, `fill_price`, global UPETI/verifyDays).

## Overview

A **Sync now** button reads broker BOUGHT/SOLD emails from a labeled Gmail folder
and updates the ledger automatically: a BOUGHT fills a matching pending plan or
creates a new active position; a SOLD exits a matching active position into
history. Fully automatic (no per-item confirmation) but every run is a
**revertible batch** ("Undo this sync"). Read-only Gmail access. This is the
natural auto-pair: a BOUGHT becomes an active position, a later SOLD of the same
ticker exits it into Trading History — a completed round-trip.

## Decisions (from brainstorming)

- **Full ledger sync** through the existing pending → active → history flow.
- **Auto-pair BOUGHT → SOLD** via that flow (not a separate round-trip matcher).
- **Unmatched BOUGHT → create an active position with nullable strategy fields**
  (no fabricated signal/SL/UPETI); editable later.
- **`actual_shares` override** so imported quantity is the real fill count.
- **Revertible batches** with an "Undo this sync" button.
- **OAuth read-only + one-time CLI** for auth.
- Subject format `BOUGHT|SOLD <QTY> <TICKER> @ <PRICE>`.

## New dependency

`googleapis` (Google's official Node client; brings OAuth2 + Gmail API). This is
the **first** third-party runtime dependency added for a feature in this repo —
called out deliberately; it is unavoidable for real Gmail access. All Gmail access
sits behind an interface so tests use a fake and never hit the network.

---

## Section 1 — Auth & config (one-time)

- **Gmail API, OAuth read-only** scope `https://www.googleapis.com/auth/gmail.readonly`.
- OAuth client id/secret from `.env` (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
  `GMAIL_REDIRECT_URI` defaulting to `http://localhost:3000/oauth2callback`);
  added to `.env.sample`.
- `GMAIL_TRADE_LABEL` in `.env` (default `Trades`).
- One-time `npm run gmail:auth`: opens the consent URL, receives the code, mints a
  **refresh token**, writes it to gitignored `.gmail-token.json`. `.gitignore`
  already covers `.env`; add `.gmail-token.json`.
- **Interface:** `GmailClient { listLabeledMessageIds(label): Promise<string[]>;
  getMessage(id): Promise<{ id, subject, dateISO }> }`. A real implementation wraps
  `googleapis`; tests inject a fake. Provided to the app via `Deps` (like
  `getNextEarnings`).
- **Config detection:** `gmailConfigured()` = client creds present AND token file
  exists. When false, `GET /api/gmail/status` returns `{ connected:false }` and the
  Sync button is disabled with a "Gmail not connected — see setup" hint. The rest
  of the app is unaffected.
- Setup documented in README/CLAUDE.md.

## Section 2 — Data-model changes

Reconciled with the **current** schema (post-redesign: `fill_price` exists,
`entry_date` gone, `upeti`/`verify_days` snapshotted from globals).

### `trades` table (new nullable columns)
- **`actual_shares REAL NULL`** — real fill quantity. Calc:
  `shares = actualShares ?? computeShares(upeti, entry, sl)`. Manual trades keep it
  null (unchanged). `deriveTrade` and P&L consume the resolved `shares`.
- **`entry_signal` → nullable.** `TradeRow.entrySignal` / `TradeDTO.entrySignal`
  become `EntrySignal | null`. `SignalPill` renders a neutral grey "Unknown" pill
  when null. `createTradeSchema` (user path) still **requires** a signal; only the
  email-create repo path writes null.
- **`upeti REAL NULL`** and **`sl_price REAL NULL`** — imported positions have
  neither. `computeShares` must guard: if `upeti`/`sl` null (and `actual_shares`
  null), shares = 0; R is null when `upeti` is null.
- **`import_source TEXT NULL`** (`'gmail'`) and **`import_batch_id TEXT NULL`**.

### New tables
- **`processed_emails(messageId TEXT PK, processedAt TEXT, batchId TEXT, result TEXT)`**
  — dedup source of truth; ids present here are skipped on later syncs.
- **`sync_batches(id TEXT PK, createdAt TEXT, summary TEXT)`** — one row per run.
- **`sync_actions(id INTEGER PK, batchId TEXT, tradeId INTEGER, action TEXT,
  prevState TEXT)`** where `action ∈ fill|exit|create`; `prevState` JSON captures
  what's needed to reverse.

### Migration
Hand-written SQL migration + `_journal.json` entry (drizzle-kit's interactive
prompt needs a TTY unavailable in this environment). SQLite: `ADD COLUMN` for the
new trade columns; nullable-izing `entry_signal`/`upeti`/`sl_price` requires a
table rebuild (create new table, copy, drop, rename) — the migration spells this
out. `CREATE TABLE` for the three new tables.

### Calc changes (`src/lib/calc.ts`)
- `computeShares(upeti, entry, sl)` returns 0 when any input is null/≤0.
- `deriveTrade`: `const shares = row.actualShares ?? computeShares(...)`; cost basis
  stays `fillPrice ?? entryPrice`; `rMultiple` null when `upeti` null.

## Section 3 — Parser & sync flow

### Parser (`src/server/gmail/parse.ts`, pure, unit-tested)
`parseTradeSubject(subject): { side:'BOUGHT'|'SOLD', qty:number, ticker:string,
price:number } | null`. Case-insensitive; tolerates `$`, thousands separators,
surrounding text. Ticker upper-cased 1–10 A–Z; qty positive integer; price
positive. Non-matching → null (caller records `unparseable_subject`).

### `POST /api/gmail/sync`
1. If not configured → 409 `{ error: 'gmail_not_connected' }`.
2. Create `batchId` (passed in from a `Deps.newId()` since `Math.random`/`Date` are
   injected for testability).
3. Fetch labeled message ids; for each **not** in `processed_emails`:
   - Parse subject; unparseable → record skip(`unparseable_subject`), mark processed.
   - **BOUGHT:** find a **pending** plan by ticker (disambiguate by qty then price
     proximity). Match → `fill` at email price, `actual_shares = qty`, `fillDate =`
     email date; log `fill`. No match → **create** a `filled` position: ticker,
     `entryPrice = price`, `fillPrice = price`, `actual_shares = qty`,
     `fillDate =` email date, `entrySignal = null`, `upeti = null`, `slPrice = null`,
     `tpPrice = null`, `earningsDate = null`, `verifyDays = 5`,
     `import_source='gmail'`, `import_batch_id=batchId`; log `create`.
   - **SOLD:** find a **filled** position by ticker (qty/price proximity). Match →
     `exit` at email price/date; log `exit`. No match → skip(`no_open_position`).
     Ambiguous tie → skip(`ambiguous_match`).
   - Record message id in `processed_emails` with its result.
4. Persist `sync_batches` summary. Return
   `{ batchId, filled:[...], exited:[...], created:[...], skipped:[{subject,reason}], errors:[...] }`.

### Matching key
Match on **ticker**, disambiguate by **qty** then **price** proximity. 0 candidates
→ create (BOUGHT) / skip (SOLD). Unbroken tie → skip(`ambiguous_match`), never guess.

## Section 4 — Undo, UI, testing

### Undo (`POST /api/gmail/sync/:batchId/undo`)
Reverse each `sync_actions` row in reverse order: `fill`→pending (clear
fill/actual_shares), `exit`→filled (clear exit price/date), `create`→delete the
trade. Remove the batch's `processed_emails` rows (so a future sync can re-handle).
Delete the `sync_batches` row. Return a summary of what was reverted.

### UI
- **Sync now** button near the header (beside `SettingsControls`). `GET
  /api/gmail/status` → `{ connected, label }` drives enabled/disabled + hint.
- On click: POST sync → result panel with counts and per-item lines
  (filled/exited/created/skipped+reason), plus **Undo this sync** while that batch
  is the latest. Toasts as elsewhere.
- Imported trades show the neutral "Unknown" signal pill; remain fully editable via
  the existing Edit form (set real signal/UPETI/SL/earnings later).

### API surface (additions)
| method + path | purpose |
|---|---|
| `GET /api/gmail/status` | `{ connected, label }` for button state. |
| `POST /api/gmail/sync` | Run a sync; batch summary. 409 if not connected. |
| `POST /api/gmail/sync/:batchId/undo` | Revert a batch. |

Plus one-time CLI `npm run gmail:auth`.

### Testing
- **Parser** unit: BOUGHT/SOLD variants, `$`/separators/extra text, extraction,
  rejects non-matching.
- **Sync engine** integration (in-memory DB, **fake GmailClient**): BOUGHT matches
  pending→filled w/ actual_shares; BOUGHT no match→new filled w/ null strategy
  fields; SOLD matches→exited; SOLD no match→skip; dedup (same id not twice);
  ambiguous→skip; undo reverts fill/exit/create + clears processed_emails.
- **Calc**: `deriveTrade` uses `actualShares ?? computeShares`; R null when upeti
  null; P&L correct for an email position with explicit shares.
- No network in tests (client behind interface).

## Risk posture
Read-only scope; token local & gitignored. Dedup prevents double application. Every
run reported and revertible. Unmatched/ambiguous cases skipped+logged, never
guessed. Nullable signal + `import_source` make imported data identifiable.

## Out of scope
Background polling; writing back to Gmail; multi-account; partial-fill aggregation
(each email = one fill/exit).

---

## Delivery split (two plans)

**Plan A — Foundations & auth (independently shippable/verifiable):**
data-model migration + calc changes + nullable-signal display; the subject parser;
the `GmailClient` interface + `googleapis` real impl; `npm run gmail:auth` CLI;
`GET /api/gmail/status`; `.env.sample` + docs. Deliverable: you can connect real
Gmail and see `status: connected`, and all parser/calc/schema tests pass — no sync
behavior yet.

**Plan B — Sync engine, undo & UI:** `POST /api/gmail/sync` (match/fill/create/exit
+ dedup + logging), `sync_batches`/`sync_actions`, `POST …/undo`, the Sync-now UI
panel + Undo button. Deliverable: end-to-end sync with undo. Depends on Plan A.
