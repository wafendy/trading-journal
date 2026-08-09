# Finnhub Earnings-Date Lookup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fill the earnings date in the create-plan form after the user enters a ticker, using the Finnhub earnings-calendar API; degrade gracefully to manual entry when unavailable.

**Architecture:** A small server-side `earnings` provider module wraps Finnhub with a timeout and returns the next upcoming earnings date or null. It is injected into the Hono app via the existing `Deps` object (so tests mock it — no network in tests). A new `GET /api/earnings?ticker=` route returns `{ earningsDate, reason? }`. The create form calls it on ticker blur and pre-fills the (still-editable) earnings field.

**Tech Stack:** existing (Hono, TanStack Query, React, Vitest, Zod). No new dependencies — uses global `fetch`.

## Global Constraints

- Bash tool shell does NOT source .zshrc — prefix every node/npm/npx command with `eval "$(mise activate zsh)" &&`. Run sandboxed (local); no network needed because tests mock the provider.
- Do NOT commit application code — after each task run `git add -A` to STAGE only (the app is kept staged, uncommitted, per project instruction). Docs/specs already committed separately.
- TypeScript strict; no `any`.
- Read-only feature: no ledger mutation, no change to how earnings are stored/validated/displayed. The earnings field stays required-on-create and keeps its existing "can't be past → +90d" behavior. A manual edit always wins over the auto-fill.
- Finnhub key from `FINNHUB_API_KEY` env (gitignored `.env`). Missing key → endpoint returns `{ earningsDate: null, reason: "no_api_key" }`, HTTP 200; the app still works.
- Finnhub endpoint: `GET https://finnhub.io/api/v1/calendar/earnings?from=<todayISO>&to=<+120d>&symbol=<TICKER>&token=<KEY>`; response `{ earningsCalendar: [{ date: "YYYY-MM-DD", symbol, ... }] }`. Select earliest `date >= today`; empty/error/timeout → null.
- Ticker rule: 1–10 A–Z chars, upper-cased.

---

## File Structure

```
src/server/earnings.ts        # provider: getNextEarningsDate + date-selection helper (Task 1,2)
src/server/earnings.test.ts   # unit tests for selection + guards
src/server/routes.ts          # add GET /api/earnings; extend Deps (Task 3)
src/server/routes.test.ts     # add route tests (Task 3)
src/server/index.ts           # wire the real provider into buildApp deps (Task 4)
src/client/api.ts             # add api.earnings (Task 5)
src/client/components/TradeForm.tsx  # ticker-blur lookup + inline status (Task 5)
README.md / CLAUDE.md         # setup note (Task 6)
```

---

### Task 1: Earnings date-selection helper (pure, TDD)

**Files:**
- Create: `src/server/earnings.ts`
- Test: `src/server/earnings.test.ts`

**Interfaces:**
- Produces: `selectNextEarningsDate(calendar: { date: string }[], todayISO: string): string | null` — earliest `date >= todayISO`; ignores malformed/past; null when none.

- [ ] **Step 1: Write the failing test** `src/server/earnings.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { selectNextEarningsDate } from './earnings';

describe('selectNextEarningsDate', () => {
  const today = '2026-08-09';
  it('picks the earliest upcoming date', () => {
    const cal = [{ date: '2026-11-19' }, { date: '2026-09-01' }, { date: '2027-02-10' }];
    expect(selectNextEarningsDate(cal, today)).toBe('2026-09-01');
  });
  it('ignores past dates', () => {
    const cal = [{ date: '2026-05-01' }, { date: '2026-08-20' }];
    expect(selectNextEarningsDate(cal, today)).toBe('2026-08-20');
  });
  it('includes today', () => {
    expect(selectNextEarningsDate([{ date: '2026-08-09' }], today)).toBe('2026-08-09');
  });
  it('returns null for empty or all-past', () => {
    expect(selectNextEarningsDate([], today)).toBeNull();
    expect(selectNextEarningsDate([{ date: '2020-01-01' }], today)).toBeNull();
  });
  it('ignores malformed dates', () => {
    expect(selectNextEarningsDate([{ date: 'n/a' }, { date: '2026-10-10' }], today)).toBe('2026-10-10');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/earnings.test.ts`
Expected: FAIL — `selectNextEarningsDate` not exported.

- [ ] **Step 3: Implement the helper in `src/server/earnings.ts`**

```ts
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function selectNextEarningsDate(calendar: { date: string }[], todayISO: string): string | null {
  const upcoming = calendar
    .map((e) => e.date)
    .filter((d) => typeof d === 'string' && ISO.test(d) && d >= todayISO)
    .sort();
  return upcoming[0] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/earnings.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 2: Finnhub provider with timeout + guards (TDD, mocked fetch)

**Files:**
- Modify: `src/server/earnings.ts`
- Test: `src/server/earnings.test.ts`

**Interfaces:**
- Produces:
  - `type EarningsProvider = (ticker: string, todayISO: string) => Promise<string | null>`
  - `createFinnhubProvider(opts: { apiKey: string | undefined; fetchImpl?: typeof fetch; timeoutMs?: number }): EarningsProvider`
  - Returns null on: missing apiKey, invalid ticker (not 1–10 A–Z after upper-casing), non-OK response, malformed body, thrown/aborted fetch. Never throws.
  - Builds the URL with `from=todayISO`, `to=todayISO+120d`, `symbol=<UPPER>`, `token=<key>`; parses `{ earningsCalendar }`; delegates to `selectNextEarningsDate`.

- [ ] **Step 1: Add failing tests to `src/server/earnings.test.ts`**

```ts
import { createFinnhubProvider } from './earnings';

const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe('createFinnhubProvider', () => {
  const today = '2026-08-09';
  it('returns null when no api key (and does not call fetch)', async () => {
    let called = false;
    const p = createFinnhubProvider({ apiKey: undefined, fetchImpl: (async () => { called = true; return okResponse({}); }) as unknown as typeof fetch });
    expect(await p('AAPL', today)).toBeNull();
    expect(called).toBe(false);
  });
  it('returns the next earnings date from the calendar', async () => {
    const fetchImpl = (async () => okResponse({ earningsCalendar: [{ date: '2026-09-01' }, { date: '2026-12-01' }] })) as unknown as typeof fetch;
    const p = createFinnhubProvider({ apiKey: 'k', fetchImpl });
    expect(await p('aapl', today)).toBe('2026-09-01');
  });
  it('rejects invalid tickers without fetching', async () => {
    let called = false;
    const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: (async () => { called = true; return okResponse({}); }) as unknown as typeof fetch });
    expect(await p('BAD TICKER!', today)).toBeNull();
    expect(called).toBe(false);
  });
  it('returns null on non-ok response', async () => {
    const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: (async () => ({ ok: false }) as Response) as unknown as typeof fetch });
    expect(await p('AAPL', today)).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: (async () => { throw new Error('network'); }) as unknown as typeof fetch });
    expect(await p('AAPL', today)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/earnings.test.ts`
Expected: FAIL — `createFinnhubProvider` not exported.

- [ ] **Step 3: Implement in `src/server/earnings.ts`**

```ts
export type EarningsProvider = (ticker: string, todayISO: string) => Promise<string | null>;

const TICKER_RE = /^[A-Z]{1,10}$/;

function plusDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function createFinnhubProvider(opts: {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): EarningsProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  return async (rawTicker, todayISO) => {
    if (!opts.apiKey) return null;
    const ticker = rawTicker.trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) return null;
    const to = plusDaysISO(todayISO, 120);
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${todayISO}&to=${to}&symbol=${ticker}&token=${opts.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as { earningsCalendar?: { date: string }[] };
      return selectNextEarningsDate(body.earningsCalendar ?? [], todayISO);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/earnings.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck + stage**

Run: `eval "$(mise activate zsh)" && npx tsc --noEmit` (clean), then `git add -A`.

---

### Task 3: `GET /api/earnings` route + injectable Dep (TDD)

**Files:**
- Modify: `src/server/routes.ts`
- Test: `src/server/routes.test.ts`

**Interfaces:**
- Consumes: `EarningsProvider` from `earnings.ts`.
- Produces:
  - `Deps` gains `getNextEarnings: EarningsProvider` (required field on the interface).
  - Route `GET /api/earnings?ticker=<T>`: validate ticker (1–10 A–Z after upper-case) → 400 `{ error }` if missing/invalid; else `todayISO = now().slice(0,10)`, call `getNextEarnings(ticker, todayISO)`, return `{ earningsDate }`. (The `no_api_key` reason is handled inside the provider returning null; the route just returns `{ earningsDate: null }`. Route does not need to distinguish reasons — keep it simple: `{ earningsDate }`.)

- [ ] **Step 1: Add failing tests to `src/server/routes.test.ts`**

Find where the test builds the app (it currently constructs `buildApp({ repo, now })`). The `Deps` change means every `buildApp` call in this file must pass `getNextEarnings`. Add a helper + tests:

```ts
// near the existing setup()/buildApp usage — add a default stub provider.
// If setup() builds the app, update it to include getNextEarnings.
// Example new tests:

describe('GET /api/earnings', () => {
  it('returns the provider result', async () => {
    const { db } = createDb(':memory:'); migrateDb(db);
    const repo = createRepo(db, () => '2026-08-09T00:00:00Z');
    const app = buildApp({ repo, now: () => '2026-08-09T00:00:00Z', getNextEarnings: async () => '2026-11-19' });
    const res = await app.request('/api/earnings?ticker=nvda');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ earningsDate: '2026-11-19' });
  });
  it('400 on missing/invalid ticker', async () => {
    const { db } = createDb(':memory:'); migrateDb(db);
    const repo = createRepo(db, () => '2026-08-09T00:00:00Z');
    const app = buildApp({ repo, now: () => '2026-08-09T00:00:00Z', getNextEarnings: async () => null });
    expect((await app.request('/api/earnings')).status).toBe(400);
    expect((await app.request('/api/earnings?ticker=BAD!')).status).toBe(400);
  });
  it('returns null earningsDate when provider yields null', async () => {
    const { db } = createDb(':memory:'); migrateDb(db);
    const repo = createRepo(db, () => '2026-08-09T00:00:00Z');
    const app = buildApp({ repo, now: () => '2026-08-09T00:00:00Z', getNextEarnings: async () => null });
    expect(await (await app.request('/api/earnings?ticker=AAPL')).json()).toEqual({ earningsDate: null });
  });
});
```

**Important:** every existing `buildApp({ repo, now })` call in `routes.test.ts` must be updated to `buildApp({ repo, now, getNextEarnings: async () => null })` (or via a shared setup helper) so the file compiles under the new required Dep.

- [ ] **Step 2: Run to verify fail**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/routes.test.ts`
Expected: FAIL — `getNextEarnings` missing on Deps / route not found.

- [ ] **Step 3: Implement in `src/server/routes.ts`**

Add to the imports:
```ts
import type { EarningsProvider } from './earnings';
```
Extend `Deps`:
```ts
export interface Deps { repo: TradeRepo; now: () => string; getNextEarnings: EarningsProvider; }
```
Destructure it and add the route (place near the other GET routes; use `TICKER_RE` inline):
```ts
export function registerRoutes(api: Hono, { repo, now, getNextEarnings }: Deps): void {
  // ...existing...
  api.get('/earnings', async (c) => {
    const raw = c.req.query('ticker') ?? '';
    const ticker = raw.trim().toUpperCase();
    if (!/^[A-Z]{1,10}$/.test(ticker)) return c.json({ error: 'valid ticker required' }, 400);
    const earningsDate = await getNextEarnings(ticker, now().slice(0, 10));
    return c.json({ earningsDate });
  });
}
```

- [ ] **Step 4: Run to verify pass (route file + full suite)**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/routes.test.ts`
Expected: PASS.
Run: `eval "$(mise activate zsh)" && npx vitest run` — full suite still green (all `buildApp` callers updated).
Run: `eval "$(mise activate zsh)" && npx tsc --noEmit` — clean.

- [ ] **Step 5: Stage**

Run: `git add -A`

---

### Task 4: Wire the real provider in the server entry

**Files:**
- Modify: `src/server/index.ts`

**Interfaces:**
- Consumes: `createFinnhubProvider`. Provides the real `getNextEarnings` to `buildApp`.

- [ ] **Step 1: Update `src/server/index.ts`**

Add import and pass the provider (reads `process.env.FINNHUB_API_KEY`):
```ts
import { createFinnhubProvider } from './earnings';
// ...
const getNextEarnings = createFinnhubProvider({ apiKey: process.env.FINNHUB_API_KEY });
const app = buildApp({ repo, now: () => new Date().toISOString(), getNextEarnings });
```
(Adjust to match the existing `buildApp({ repo, now: ... })` call already in the file.)

- [ ] **Step 2: Typecheck + boot smoke**

Run: `eval "$(mise activate zsh)" && npx tsc --noEmit` — clean.
Run (no key set → should return null, not error):
`eval "$(mise activate zsh)" && (DB_PATH=/tmp/tj-earn.db PORT=3210 tsx src/server/index.ts &) ; sleep 3 ; curl -s "http://localhost:3210/api/earnings?ticker=AAPL" ; echo ; pkill -f "tsx src/server/index.ts" ; rm -f /tmp/tj-earn.db*`
Expected: `{"earningsDate":null}` (no key configured). Confirm the server was killed.

- [ ] **Step 3: Stage**

Run: `git add -A`

---

### Task 5: Client — `api.earnings` + ticker-blur auto-fill

**Files:**
- Modify: `src/client/api.ts`, `src/client/components/TradeForm.tsx`

**Interfaces:**
- Consumes: `GET /api/earnings`.
- Produces:
  - `api.earnings(ticker: string): Promise<{ earningsDate: string | null }>`
  - TradeForm: on ticker blur (non-empty, changed since last lookup, and the user hasn't manually typed an earnings date), fetch and set `earningsDate`; show an inline status ('loading' | 'fetched' | 'notfound' | 'idle'). Manual edit always wins.

- [ ] **Step 1: Add to `src/client/api.ts`** (inside the `api` object)

```ts
  earnings: (ticker: string) =>
    fetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`).then(json<{ earningsDate: string | null }>),
```

- [ ] **Step 2: Update `src/client/components/TradeForm.tsx`**

Add state near the other hooks:
```tsx
const [earningsStatus, setEarningsStatus] = useState<'idle' | 'loading' | 'fetched' | 'notfound'>('idle');
const [earningsEdited, setEarningsEdited] = useState(false);
const [lastLookedUp, setLastLookedUp] = useState('');
```
Add a blur handler:
```tsx
const lookupEarnings = async () => {
  const t = ticker.trim().toUpperCase();
  if (!t || t === lastLookedUp || earningsEdited) return;
  setLastLookedUp(t);
  setEarningsStatus('loading');
  try {
    const { earningsDate: found } = await api.earnings(t);
    if (found && !earningsEdited) { setEarningsDate(found); setEarningsStatus('fetched'); }
    else setEarningsStatus('notfound');
  } catch { setEarningsStatus('notfound'); }
};
```
Wire it: on the Ticker input add `onBlur={lookupEarnings}`. On the Earnings date input's `onChange`, also `setEarningsEdited(true)` (so a manual value is never overwritten). Under the earnings field, render a hint based on `earningsStatus`:
```tsx
{earningsStatus === 'loading' && <span className="mt-1 block text-xs text-slate-400">Looking up earnings…</span>}
{earningsStatus === 'fetched' && <span className="mt-1 block text-xs text-slate-400">Fetched from Finnhub</span>}
{earningsStatus === 'notfound' && <span className="mt-1 block text-xs text-slate-400">No earnings date found — enter manually</span>}
```
(Keep the existing `earningsDateError` red hint too.) Reset `earningsStatus`/`earningsEdited`/`lastLookedUp` when the modal closes if the form state is reset.

- [ ] **Step 3: Typecheck + build**

Run: `eval "$(mise activate zsh)" && npx tsc --noEmit` — clean.
Run: `eval "$(mise activate zsh)" && npm run build` — succeeds.

- [ ] **Step 4: Full suite**

Run: `eval "$(mise activate zsh)" && npx vitest run` — still green (client change adds no tests; server tests unaffected).

- [ ] **Step 5: Stage**

Run: `git add -A`

---

### Task 6: Docs — setup note

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README.md — add under Setup/Concepts**

```markdown
### Earnings auto-fill (optional)
Set `FINNHUB_API_KEY` in `.env` (get a free key at finnhub.io). When creating a
plan, the earnings date auto-fills from Finnhub after you enter a ticker. Without
a key, the field stays manual — nothing else changes.
```

- [ ] **Step 2: CLAUDE.md — add a line under Commands/Architecture**

```markdown
- Earnings lookup: `src/server/earnings.ts` (Finnhub provider, injected via Deps.getNextEarnings; returns null without FINNHUB_API_KEY). Route `GET /api/earnings?ticker=`. Client auto-fills on ticker blur in TradeForm.
```

- [ ] **Step 3: Confirm `.gitignore` covers `.env`** (it already does) and stage.

Run: `eval "$(mise activate zsh)" && git add -A`

---

## Self-Review

**Spec coverage:**
- Trigger on ticker entry (blur), auto-fill, manual override → Task 5 ✓
- Finnhub provider, 120d window, earliest upcoming, timeout, null-on-error → Tasks 1–2 ✓
- Missing key → null, app still works → Tasks 2 (provider) + 4 (wiring) ✓
- `GET /api/earnings` returns `{ earningsDate }`, 400 on bad ticker → Task 3 ✓
- Injectable/testable (no network in tests) → Deps.getNextEarnings, mocked fetch ✓
- No ledger mutation, earnings field rules unchanged → enforced by scope (Task 5 only pre-fills) ✓
- Setup docs → Task 6 ✓

**Placeholder scan:** No TBD/TODO; all steps have concrete code. The `index.ts` and `routes.test.ts` edits reference existing structures the implementer must match (noted explicitly).

**Type consistency:** `EarningsProvider` signature `(ticker, todayISO) => Promise<string|null>` is identical across earnings.ts, Deps, and the route call. `api.earnings` returns `{ earningsDate: string | null }` matching the route's response.
