# Sub-project A — Finnhub Earnings-Date Lookup — Design Spec

**Date:** 2026-08-09
**Status:** Approved
**Depends on:** existing trading-journal app (manual earnings-date field already present).

## Overview

When creating a Trading Plan, auto-fill the earnings date shortly after the user
enters a ticker, using the Finnhub earnings-calendar API. Read-only, no ledger
mutation. Degrades gracefully to the existing manual field when the API key is
absent or the lookup fails.

## Why Finnhub (not EarningsWhispers)

EarningsWhispers has no official/public API; its internal endpoint returns HTML
error pages to non-browser requests and would require a fragile headless-browser
scrape. Finnhub is documented, keyed, free-tier, and returns the next confirmed
earnings date reliably. This sub-project therefore uses Finnhub. The earnings
provider is isolated behind one module so the source can be swapped later.

## Trigger & flow

1. In the create-plan form, when the **ticker field loses focus** (debounced;
   only when the ticker is non-empty and changed), the client calls
   `GET /api/earnings?ticker=<TICKER>`.
2. Server calls Finnhub `stock/earnings-calendar` (see API below) for a window
   of today → today+120 days, selects the **earliest upcoming** earnings date,
   and returns `{ earningsDate: "YYYY-MM-DD" | null, reason?: string }`.
3. Client behavior:
   - date returned → set the earnings-date field to it (still editable; the
     existing "earnings can't be past → +90d" and required-on-create rules
     continue to apply).
   - null → leave the field for manual entry; show a small inline status
     ("No earnings date found — enter manually" or "Fetched from Finnhub").
   - The field is never locked; a manual edit always wins.

The auto-fill only runs on the create form (not the Edit-position form).

## Server pieces

### Config
- `FINNHUB_API_KEY` read from a gitignored `.env` via the server process env.
- If the key is missing/empty, `GET /api/earnings` returns
  `{ earningsDate: null, reason: "no_api_key" }` (HTTP 200). The app remains
  fully functional with manual entry; no error surfaced to the user beyond the
  inline "enter manually" hint.

### Provider module — `src/server/earnings.ts`
- `getNextEarningsDate(ticker: string, todayISO: string): Promise<string | null>`
  - Returns the earliest earnings date >= today within a 120-day window, or null.
  - Uses `fetch` with a hard timeout (e.g. 5s via `AbortController`). Any
    network/parse/timeout error → returns null (never throws to the route).
  - Finnhub request:
    `GET https://finnhub.io/api/v1/calendar/earnings?from=<today>&to=<today+120d>&symbol=<TICKER>&token=<KEY>`
  - Response shape: `{ earningsCalendar: [{ date: "YYYY-MM-DD", symbol, ... }] }`.
    Filter `date >= today`, sort ascending, take the first `date`. Empty → null.
- Ticker is upper-cased and validated (1–10 A–Z chars) before the call; invalid
  → null without hitting the network.

### Route — in `src/server/routes.ts`
- `GET /api/earnings?ticker=<T>`:
  - Validate ticker (Zod / same rule). Missing/invalid → 400.
  - Compute `todayISO` from the injected `now()`.
  - Return `{ earningsDate, reason? }` from the provider.
- No auth, consistent with the local single-user app.

### Client — `src/client/api.ts`
- `earnings: (ticker: string) => fetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`).then(json<{ earningsDate: string | null; reason?: string }>)`

### Client — `TradeForm.tsx`
- On ticker blur (guarded: non-empty, changed since last lookup, and the user
  hasn't already manually typed an earnings date), call `api.earnings`, and on a
  non-null result set `earningsDate`. Track a small `earningsStatus` state
  ('idle' | 'loading' | 'fetched' | 'notfound') for the inline hint.
- Never overwrite a manually-entered earnings date.

## Testing

- Unit-test the provider's date selection against a mocked Finnhub response:
  picks the earliest upcoming date; ignores past dates; empty calendar → null;
  network error/timeout → null; missing key → null (no fetch).
- Route test: valid ticker returns the provider's value; invalid ticker → 400;
  no key configured → `{ earningsDate: null, reason: "no_api_key" }`.
- Keep the deterministic server tests independent of the network (inject the
  provider / mock `fetch`).

## Out of scope
- No caching layer (a follow-up could cache per ticker/day).
- No batch prefetch; single-ticker on demand only.
- No change to how earnings dates are stored, validated, or displayed.

## Setup notes (README/CLAUDE.md addition)
- Get a free key at finnhub.io; put `FINNHUB_API_KEY=...` in `.env` (gitignored).
- Without it, earnings auto-fill is simply skipped.
