# Sub-project B — Gmail → Automatic Fills & Exits — Design Spec

**Date:** 2026-08-09
**Status:** Approved
**Depends on:** existing trading-journal app. Independent of Sub-project A.

## Overview

A "Sync now" button reads broker BOUGHT/SOLD emails from a labeled Gmail folder
and automatically updates the ledger: fills matching pending plans, exits
matching active positions, and creates new filled positions from unmatched buys.
Fully automatic (no per-item confirmation) but every run is a **revertible
batch** ("Undo this sync"). Read-only Gmail access.

## Auth & config (one-time)

- **Gmail API, OAuth read-only** (`https://www.googleapis.com/auth/gmail.readonly`).
- One-time browser consent; a **refresh token** is persisted locally in a
  gitignored file (e.g. `.gmail-token.json`). OAuth client id/secret come from
  `.env` (gitignored). Nothing secret is committed.
- If Gmail isn't configured (no client creds / no token), the Sync button is
  shown but disabled with a "Gmail not connected — see setup" hint. The rest of
  the app is unaffected.
- Setup steps documented in README/CLAUDE.md (create Google Cloud OAuth client,
  run a one-time `npm run gmail:auth` to mint the token).

## Email selection & parsing

- **Scope:** only messages under a configured Gmail **label** (default `Trades`;
  label name in `.env`, e.g. `GMAIL_TRADE_LABEL=Trades`). Query:
  `label:<label>` plus a not-already-processed filter applied in code.
- **Subject format:** `BOUGHT|SOLD <QTY> <TICKER> @ <PRICE>`
  (case-insensitive; tolerate `$`, thousands separators, and extra surrounding
  text). Parser extracts `{ side: 'BOUGHT'|'SOLD', qty: number, ticker: string,
  price: number }`. Anything that doesn't match → **skip + log** (reason
  `unparseable_subject`).
- Ticker upper-cased; qty positive integer; price positive number.

## Dedup

- Table `processed_emails(messageId TEXT PRIMARY KEY, processedAt TEXT,
  batchId TEXT, result TEXT)`. Each Gmail message id handled in a sync is stored;
  already-present ids are skipped on future syncs. This is the source of truth
  for "already handled".

## Data-model changes

### `trades` table
- Add `actual_shares REAL NULL`. When non-null (set from an email fill), position
  size and P&L use it **instead of** the derived `floor(upeti/(entry−sl))`.
  Shared calc becomes: `shares = actualShares ?? computeShares(upeti, entry, sl)`.
  Manually-created trades keep `actual_shares = null` (unchanged behavior).
- `entry_signal` must allow **null/unknown** for imported trades. Change: the
  column becomes nullable; `TradeDTO.entrySignal` becomes `EntrySignal | null`;
  the SignalPill renders a neutral "—"/grey "Unknown" pill when null.
  Validation: create-from-user still requires a signal; the repository's
  email-create path may write null.
- Add `import_batch_id TEXT NULL` and `import_source TEXT NULL` (e.g. 'gmail')
  so imported/auto-modified trades can be identified and a batch reverted.

### `sync_batches` table (for undo + history)
- `sync_batches(id TEXT PRIMARY KEY, createdAt TEXT, summary TEXT)` — one row per
  Sync run. Actions taken in the run reference this id (via `processed_emails`
  and, for reversal, an actions log — see Undo).

### Undo log
- Table `sync_actions(id INTEGER PK, batchId TEXT, tradeId INTEGER,
  action TEXT, prevState TEXT)` where `action ∈ fill|exit|create` and `prevState`
  captures what's needed to reverse:
  - `fill` → prevState = the pre-fill status/fields (revert to `pending`, clear
    fill/actual_shares).
  - `exit` → prevState = pre-exit fields (revert to `filled`, clear
    exit price/date).
  - `create` → no prevState needed (reverse = delete the created trade).

## Sync flow (POST /api/gmail/sync)

1. Require Gmail configured, else 409 `{ error: "gmail_not_connected" }`.
2. Create a `batchId`.
3. Fetch labeled messages; for each whose id is **not** in `processed_emails`:
   a. Parse subject. Unparseable → record skip(reason), mark processed.
   b. **BOUGHT:**
      - Find a **pending** plan matching ticker (+ prefer closest shares/price
        when multiple). If found → `fill` it at email price, set
        `actual_shares = qty`; log a `fill` action.
      - Else → **create** a new `filled` trade: ticker, entryPrice = price,
        actual_shares = qty, entryDate/fillDate = email date, entrySignal = null,
        upeti = last-remembered (or 100), slPrice = 5% below price, tpPrice = 10%
        above, earningsDate = null (existing "no date" warning will surface it),
        verifyDays = 5, import_source='gmail', import_batch_id=batchId; log a
        `create` action.
   c. **SOLD:**
      - Find a matching **filled** position (ticker, prefer matching
        shares/price). If found → `exit` at email price/date, log an `exit`
        action.
      - Else → **skip + log** (reason `no_open_position`).
   d. Record the message id in `processed_emails` with its result.
4. Persist the `sync_batches` summary. Return:
   `{ batchId, filled: [...], exited: [...], created: [...], skipped: [{subject,reason}], errors: [...] }`.

### Matching key
- Match on **ticker**, then disambiguate by **shares** then **price** proximity.
- If 0 candidates → create (BOUGHT) or skip (SOLD). If multiple after
  disambiguation ties → act on the best single match; if still ambiguous, skip +
  log (`ambiguous_match`) rather than guess.

## Undo (POST /api/gmail/sync/:batchId/undo)

- Reverse every `sync_actions` row for the batch in reverse order:
  fill→pending, exit→filled, create→delete. Remove the batch's
  `processed_emails` rows so a future sync can re-handle those messages. Delete
  the `sync_batches` row. Return a summary of what was reverted.
- The most recent sync's summary panel shows an **"Undo this sync"** button.

## UI

- A **Sync now** button (header or a small "Integrations" area). On click: POST
  sync, show a result panel: counts + per-item lines (filled/exited/created/
  skipped with reasons), and an **Undo this sync** button while that batch is the
  latest. Success/error toasts as elsewhere.
- Imported trades display with a neutral/unknown signal pill and remain fully
  editable via the existing Edit form (you can set the real signal, UPETI, SL,
  earnings later).

## API surface (additions)

| method + path | purpose |
|---|---|
| `GET /api/gmail/status` | `{ connected: boolean, label: string }` for button state. |
| `POST /api/gmail/sync` | Run a sync; returns the batch summary. 409 if not connected. |
| `POST /api/gmail/sync/:batchId/undo` | Revert a batch. |

Plus a one-time CLI `npm run gmail:auth` to perform OAuth and store the token.

## Testing

- **Subject parser** (unit): BOUGHT/SOLD variants, `$`/separators/extra text,
  qty & price extraction, rejects non-matching subjects.
- **Sync engine** (integration, in-memory DB, mocked Gmail client): 
  - BOUGHT matches pending → filled with actual_shares.
  - BOUGHT no match → new filled position with defaults + null signal.
  - SOLD matches filled → exited; SOLD no match → skipped+logged.
  - Dedup: same message id not processed twice.
  - Ambiguous multi-match → skipped+logged.
  - Undo reverts fill/exit/create and clears processed_emails for the batch.
- **Calc**: `deriveTrade` uses `actualShares ?? computeShares(...)`; P&L correct
  for an email position with explicit shares. Add tests.
- Gmail API client is behind an interface so tests inject a fake; no network in
  tests.

## Risk posture
- Read-only Gmail scope; token local & gitignored.
- Dedup prevents double application.
- Every run is reported and **revertible** (undo).
- Unmatched/ambiguous cases are skipped + logged, never guessed.
- Nullable signal + `import_source` make imported/auto data identifiable.

## Out of scope
- Background polling (manual Sync only for now).
- Writing back to Gmail (no label removal; read-only).
- Multi-account Gmail.
- Partial-fill aggregation (each email treated as one fill/exit).
