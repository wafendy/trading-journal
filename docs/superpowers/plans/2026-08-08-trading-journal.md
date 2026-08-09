# Trading Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local single-user web app to track US stock trading: current plan (pending + active), infinite-scroll history, and a per-year performance summary with a cumulative equity curve.

**Architecture:** Single package (Option A). Hono (`@hono/node-server`) exposes `/api/*` and serves the built Vite client in production; in dev, Vite proxies `/api` to Hono. SQLite (`better-sqlite3`) via Drizzle ORM. All money math lives in a shared `src/lib/calc.ts` imported by both server and client — single source of truth. React + TanStack Query + Tailwind + Recharts on the client.

**Tech Stack:** Vite, React 18+/TS, Hono, @hono/node-server, better-sqlite3, drizzle-orm, drizzle-kit, tailwindcss v4 (@tailwindcss/vite), @tanstack/react-query, recharts, zod, vitest, tsx.

## Global Constraints

- **Node required** in the execution environment (not present in the planning sandbox). Install deps with `@latest` so versions resolve to current latest at install time.
- **TypeScript strict mode** everywhere (`"strict": true`).
- **No auth**, single user, local only. No fees. Gross P&L. Weekends-only for weekday counting (no US holidays). No cross-year aggregation.
- **Currency:** USD. Prices/P&L are `real` (float) in SQLite.
- **Dates:** ISO `YYYY-MM-DD` strings for dates; ISO datetime strings for `created_at`/`updated_at`.
- **Money math is centralized** in `src/lib/calc.ts`. Server computes derived fields (`shares`, `realizedPnl`, `rMultiple`, `dudFlagged`) into every trade response; client reuses calc for live previews only.
- **Enums (verbatim):** `entryType` ∈ `buy_limit | buy_stop`. `entrySignal` ∈ `btb | buy_lautan | buy_magenta | hawk1 | buy_spec`. `status` ∈ `pending | filled | exited`. `verifyDays` ∈ `5 | 7 | 10 | 14`. `dudDecision` ∈ `null | keep | exit`.
- **Signal pill colors:** btb=green, buy_lautan=light blue, buy_magenta=magenta, hawk1=dark green, buy_spec=pink.
- **Formulas:** `shares = floor(upeti / (entryPrice − slPrice))`; `realizedPnl = (exitPrice − entryPrice) × shares`; `rMultiple = realizedPnl / upeti`; dud flagged when `status==='filled' && dudDecision===null && weekdaysBetween(fillDate, today) >= verifyDays`.
- **Ordering:** history `exit_date DESC, id DESC`; equity curve `exit_date ASC, id ASC` (running sum). Keyset pagination with a **composite cursor** `"<exitDate>|<id>"` (string) = last seen row's exit_date and id, page size 50. Query: `exit_date < cExit OR (exit_date = cExit AND id < cId)`. (A plain id-only cursor is WRONG here: id order and exit_date order diverge when trades exit out of creation order, causing dropped/duplicated rows.)
- **Year attribution:** by `exit_date` year. `winRate` = trades with `realizedPnl > 0` ÷ tradeCount; 0 when tradeCount 0.
- **Commit after every task.** Use conventional commit messages.

---

## File Structure

```
trading-journal/
  package.json
  tsconfig.json                 # base (strict)
  tsconfig.node.json            # server/config build
  vite.config.ts                # React plugin, tailwind, /api proxy, test config
  drizzle.config.ts
  index.html
  .gitignore                    # (exists)
  src/
    lib/
      types.ts                  # shared enums, Trade types, DTOs (Task 2)
      calc.ts                   # money math + weekdaysBetween + derive (Task 2)
      calc.test.ts
    server/
      db/
        schema.ts               # Drizzle tables (Task 3)
        index.ts                # db connection factory (Task 3)
      validation.ts             # Zod schemas (Task 4)
      repository.ts             # trade queries/mutations (Task 5)
      repository.test.ts
      routes.ts                 # Hono route definitions (Task 6)
      routes.test.ts
      app.ts                    # buildApp(db) -> Hono app (Task 6)
      index.ts                  # server entry: node-server + static serve (Task 7)
    client/
      main.tsx                  # React root + QueryClient (Task 8)
      api.ts                    # typed fetch wrappers (Task 8)
      App.tsx                   # layout composition (Task 12)
      components/
        SignalPill.tsx          # (Task 9)
        StatTiles.tsx           # (Task 10)
        EquityChart.tsx         # (Task 10)
        YearSelector.tsx        # (Task 10)
        TradeForm.tsx           # create modal (Task 11)
        ExitForm.tsx            # exit modal (Task 11)
        PlanTables.tsx          # pending + active sections (Task 11)
        HistoryTable.tsx        # infinite scroll (Task 12)
      index.css                 # tailwind entry
```

---

### Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/client/main.tsx`, `src/client/index.css`, `drizzle.config.ts`
- Modify: `.gitignore` (already has node_modules, trading.db, dist, .env)

**Interfaces:**
- Produces: working `npm run dev` (client+server), `npm test` (vitest), `npm run build`. A `buildApp`/`main.tsx` stub that renders "Trading Journal".

- [ ] **Step 1: Init package and install deps**

```bash
npm init -y
npm install hono @hono/node-server better-sqlite3 drizzle-orm zod @tanstack/react-query recharts react react-dom
npm install -D vite @vitejs/plugin-react typescript tsx vitest jsdom @testing-library/react @testing-library/jest-dom drizzle-kit tailwindcss @tailwindcss/vite @types/react @types/react-dom @types/better-sqlite3 npm-run-all
```

- [ ] **Step 2: Write `package.json` scripts**

Replace the `scripts` block:

```json
{
  "type": "module",
  "scripts": {
    "dev": "run-p dev:*",
    "dev:client": "vite",
    "dev:server": "tsx watch src/server/index.ts",
    "build": "tsc -b && vite build",
    "start": "NODE_ENV=production tsx src/server/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json` (strict)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src"]
}
```

Write minimal `tsconfig.node.json`:

```json
{ "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "bundler", "strict": true }, "include": ["vite.config.ts", "drizzle.config.ts"] }
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', globals: true, setupFiles: [] },
});
```

- [ ] **Step 5: Write `index.html`, `src/client/index.css`, `src/client/main.tsx`**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Trading Journal</title></head>
  <body><div id="root"></div><script type="module" src="/src/client/main.tsx"></script></body>
</html>
```

`src/client/index.css`:
```css
@import "tailwindcss";
```

`src/client/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><h1 className="text-xl font-bold p-4">Trading Journal</h1></StrictMode>
);
```

- [ ] **Step 6: Write `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: './trading.db' },
});
```

- [ ] **Step 7: Verify build/test tooling runs**

Run: `npm run build`
Expected: succeeds (tsc + vite build produce `dist/`).
Run: `npx vitest run` → Expected: "No test files found" (exit 0 or passes).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite+hono+drizzle project"
```

---

### Task 2: Shared types & calc core (TDD)

**Files:**
- Create: `src/lib/types.ts`, `src/lib/calc.ts`, `src/lib/calc.test.ts`

**Interfaces:**
- Produces:
  - `types.ts` — `EntryType`, `EntrySignal`, `TradeStatus`, `VerifyDays`, `DudDecision` union types; `TradeRow` (raw DB shape, camelCase); `TradeDTO = TradeRow & { shares: number; realizedPnl: number | null; rMultiple: number | null; dudFlagged: boolean }`.
  - `calc.ts`:
    - `computeShares(upeti: number, entryPrice: number, slPrice: number): number`
    - `computePnl(entryPrice: number, exitPrice: number, shares: number): number`
    - `computeR(pnl: number, upeti: number): number`
    - `weekdaysBetween(fromISO: string, toISO: string): number` (whole weekdays elapsed, exclusive of start day, counts Mon–Fri)
    - `isDudFlagged(t: { status: TradeStatus; dudDecision: DudDecision; fillDate: string | null; verifyDays: number }, todayISO: string): boolean`
    - `deriveTrade(row: TradeRow, todayISO: string): TradeDTO`

- [ ] **Step 1: Write `src/lib/types.ts`**

```ts
export type EntryType = 'buy_limit' | 'buy_stop';
export type EntrySignal = 'btb' | 'buy_lautan' | 'buy_magenta' | 'hawk1' | 'buy_spec';
export type TradeStatus = 'pending' | 'filled' | 'exited';
export type VerifyDays = 5 | 7 | 10 | 14;
export type DudDecision = null | 'keep' | 'exit';

export interface TradeRow {
  id: number;
  ticker: string;
  upeti: number;
  entryPrice: number;
  slPrice: number;
  tpPrice: number | null;
  entryType: EntryType;
  entrySignal: EntrySignal;
  entryDate: string;
  earningsDate: string | null;
  verifyDays: number;
  status: TradeStatus;
  fillDate: string | null;
  dudDecision: DudDecision;
  exitPrice: number | null;
  exitDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeDTO extends TradeRow {
  shares: number;
  realizedPnl: number | null;
  rMultiple: number | null;
  dudFlagged: boolean;
}
```

- [ ] **Step 2: Write failing tests `src/lib/calc.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { computeShares, computePnl, computeR, weekdaysBetween, isDudFlagged, deriveTrade } from './calc';
import type { TradeRow } from './types';

describe('computeShares', () => {
  it('floors fractional shares', () => {
    // 1000 / (50-45=5) = 200
    expect(computeShares(1000, 50, 45)).toBe(200);
    // 1000 / (10-7=3) = 333.33 -> 333
    expect(computeShares(1000, 10, 7)).toBe(333);
  });
});

describe('computePnl', () => {
  it('is positive on a win', () => { expect(computePnl(50, 55, 200)).toBe(1000); });
  it('is negative on a loss', () => { expect(computePnl(50, 45, 200)).toBe(-1000); });
});

describe('computeR', () => {
  it('divides pnl by risk', () => { expect(computeR(2300, 1000)).toBeCloseTo(2.3); });
});

describe('weekdaysBetween', () => {
  it('counts weekdays exclusive of start', () => {
    // Mon 2026-08-03 -> Fri 2026-08-07 = 4 weekdays
    expect(weekdaysBetween('2026-08-03', '2026-08-07')).toBe(4);
  });
  it('skips weekends', () => {
    // Fri 2026-08-07 -> Mon 2026-08-10 = 1 weekday
    expect(weekdaysBetween('2026-08-07', '2026-08-10')).toBe(1);
  });
  it('is zero for same day', () => { expect(weekdaysBetween('2026-08-07', '2026-08-07')).toBe(0); });
});

describe('isDudFlagged', () => {
  const base = { status: 'filled' as const, dudDecision: null, fillDate: '2026-08-03', verifyDays: 5 };
  it('flags when weekdays elapsed >= verifyDays', () => {
    // 2026-08-03 Mon -> 2026-08-10 Mon = 5 weekdays
    expect(isDudFlagged(base, '2026-08-10')).toBe(true);
  });
  it('does not flag one weekday short', () => {
    // -> Fri 08-07 = 4 weekdays
    expect(isDudFlagged(base, '2026-08-07')).toBe(false);
  });
  it('never flags pending', () => {
    expect(isDudFlagged({ ...base, status: 'pending', fillDate: null }, '2026-08-31')).toBe(false);
  });
  it('never flags once decided', () => {
    expect(isDudFlagged({ ...base, dudDecision: 'keep' }, '2026-08-31')).toBe(false);
  });
});

describe('deriveTrade', () => {
  const row: TradeRow = {
    id: 1, ticker: 'AAPL', upeti: 1000, entryPrice: 50, slPrice: 45, tpPrice: 60,
    entryType: 'buy_limit', entrySignal: 'btb', entryDate: '2026-08-03', earningsDate: '2026-08-25', verifyDays: 5,
    status: 'exited', fillDate: '2026-08-03', dudDecision: null, exitPrice: 55, exitDate: '2026-08-20',
    createdAt: '2026-08-03T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z',
  };
  it('computes shares, pnl, r for exited', () => {
    const d = deriveTrade(row, '2026-08-21');
    expect(d.shares).toBe(200);
    expect(d.realizedPnl).toBe(1000);
    expect(d.rMultiple).toBeCloseTo(1);
    expect(d.dudFlagged).toBe(false);
  });
  it('leaves pnl null when not exited', () => {
    const d = deriveTrade({ ...row, status: 'filled', exitPrice: null, exitDate: null }, '2026-08-21');
    expect(d.realizedPnl).toBeNull();
    expect(d.rMultiple).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/calc.test.ts`
Expected: FAIL — `calc.ts` has no exports / module not found.

- [ ] **Step 4: Implement `src/lib/calc.ts`**

```ts
import type { TradeRow, TradeDTO, TradeStatus, DudDecision } from './types';

export function computeShares(upeti: number, entryPrice: number, slPrice: number): number {
  const risk = entryPrice - slPrice;
  if (risk <= 0) return 0;
  return Math.floor(upeti / risk);
}

export function computePnl(entryPrice: number, exitPrice: number, shares: number): number {
  return (exitPrice - entryPrice) * shares;
}

export function computeR(pnl: number, upeti: number): number {
  if (upeti === 0) return 0;
  return pnl / upeti;
}

/** Whole weekdays (Mon–Fri) strictly after `from`, up to and including `to`. */
export function weekdaysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + 'T00:00:00Z');
  const to = new Date(toISO + 'T00:00:00Z');
  if (to <= from) return 0;
  let count = 0;
  const cur = new Date(from);
  while (cur < to) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const day = cur.getUTCDay(); // 0 Sun .. 6 Sat
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export function isDudFlagged(
  t: { status: TradeStatus; dudDecision: DudDecision; fillDate: string | null; verifyDays: number },
  todayISO: string,
): boolean {
  if (t.status !== 'filled' || t.dudDecision !== null || !t.fillDate) return false;
  return weekdaysBetween(t.fillDate, todayISO) >= t.verifyDays;
}

export function deriveTrade(row: TradeRow, todayISO: string): TradeDTO {
  const shares = computeShares(row.upeti, row.entryPrice, row.slPrice);
  const exited = row.status === 'exited' && row.exitPrice !== null;
  const realizedPnl = exited ? computePnl(row.entryPrice, row.exitPrice as number, shares) : null;
  const rMultiple = realizedPnl !== null ? computeR(realizedPnl, row.upeti) : null;
  return { ...row, shares, realizedPnl, rMultiple, dudFlagged: isDudFlagged(row, todayISO) };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/calc.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/lib && git commit -m "feat: shared trade types and calc core with tests"
```

---

### Task 3: Database schema & connection

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/index.ts`
- Generates: `drizzle/` migration

**Interfaces:**
- Consumes: enums from `src/lib/types.ts`.
- Produces:
  - `schema.ts` — `trades` table, `appSettings` table (Drizzle sqlite-core).
  - `index.ts` — `createDb(path: string)` returning `{ db, sqlite }`; `migrateDb(db)` applying `./drizzle`. Column names snake_case in DB, camelCase in TS via Drizzle mapping.

- [ ] **Step 1: Write `src/server/db/schema.ts`**

```ts
import { sqliteTable, integer, real, text } from 'drizzle-orm/sqlite-core';

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticker: text('ticker').notNull(),
  upeti: real('upeti').notNull(),
  entryPrice: real('entry_price').notNull(),
  slPrice: real('sl_price').notNull(),
  tpPrice: real('tp_price'),
  entryType: text('entry_type').notNull(),
  entrySignal: text('entry_signal').notNull(),
  entryDate: text('entry_date').notNull(),
  earningsDate: text('earnings_date'),
  verifyDays: integer('verify_days').notNull(),
  status: text('status').notNull().default('pending'),
  fillDate: text('fill_date'),
  dudDecision: text('dud_decision'),
  exitPrice: real('exit_price'),
  exitDate: text('exit_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

- [ ] **Step 2: Write `src/server/db/index.ts`**

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

export function createDb(path: string): { db: DB; sqlite: Database.Database } {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function migrateDb(db: DB): void {
  migrate(db, { migrationsFolder: './drizzle' });
}
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: creates `drizzle/0000_*.sql` with both tables.

- [ ] **Step 4: Verify migration applies to a temp DB**

Run: `node --import tsx -e "import('./src/server/db/index.ts').then(m=>{const{db,sqlite}=m.createDb(':memory:');m.migrateDb(db);console.log(sqlite.prepare(\"select name from sqlite_master where type='table'\").all());})"`
Expected: lists `trades`, `app_settings` (plus drizzle migration table).

- [ ] **Step 5: Commit**

```bash
git add src/server/db drizzle && git commit -m "feat: drizzle schema and db connection"
```

---

### Task 4: Zod validation schemas (TDD)

**Files:**
- Create: `src/server/validation.ts`
- Test: add to `src/server/validation.test.ts`

**Interfaces:**
- Produces:
  - `createTradeSchema` → `{ ticker, upeti, entryPrice, slPrice, tpPrice?, entryType, entrySignal, entryDate, earningsDate, verifyDays }` (earningsDate required ISO) with refinement `slPrice < entryPrice`.
  - `patchTradeSchema` (all above optional).
  - `fillSchema` `{ fillDate: string }`; `cancelSchema` (empty); `exitSchema` `{ exitPrice: number; exitDate: string }`; `dudDecisionSchema` = discriminated: `{ decision: 'keep' }` OR `{ decision: 'exit', exitPrice: number, exitDate: string }`.
  - `CreateTradeInput` etc. via `z.infer`.

- [ ] **Step 1: Write failing tests `src/server/validation.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createTradeSchema, dudDecisionSchema, exitSchema } from './validation';

describe('createTradeSchema', () => {
  const valid = { ticker: 'aapl', upeti: 1000, entryPrice: 50, slPrice: 45, entryType: 'buy_limit', entrySignal: 'btb', entryDate: '2026-08-03', earningsDate: '2026-08-25', verifyDays: 5 };
  it('accepts valid input and uppercases ticker', () => {
    const r = createTradeSchema.parse(valid);
    expect(r.ticker).toBe('AAPL');
  });
  it('rejects sl >= entry', () => {
    expect(() => createTradeSchema.parse({ ...valid, slPrice: 55 })).toThrow();
  });
  it('rejects bad verifyDays', () => {
    expect(() => createTradeSchema.parse({ ...valid, verifyDays: 3 })).toThrow();
  });
  it('rejects bad signal', () => {
    expect(() => createTradeSchema.parse({ ...valid, entrySignal: 'nope' })).toThrow();
  });
});

describe('dudDecisionSchema', () => {
  it('accepts keep without prices', () => {
    expect(dudDecisionSchema.parse({ decision: 'keep' })).toEqual({ decision: 'keep' });
  });
  it('requires prices for exit', () => {
    expect(() => dudDecisionSchema.parse({ decision: 'exit' })).toThrow();
    expect(dudDecisionSchema.parse({ decision: 'exit', exitPrice: 55, exitDate: '2026-08-20' }).decision).toBe('exit');
  });
});

describe('exitSchema', () => {
  it('requires price and date', () => {
    expect(() => exitSchema.parse({ exitPrice: 55 })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/validation.ts`**

```ts
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const entryType = z.enum(['buy_limit', 'buy_stop']);
const entrySignal = z.enum(['btb', 'buy_lautan', 'buy_magenta', 'hawk1', 'buy_spec']);
const verifyDays = z.union([z.literal(5), z.literal(7), z.literal(10), z.literal(14)]);

export const createTradeSchema = z.object({
  ticker: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  upeti: z.number().positive(),
  entryPrice: z.number().positive(),
  slPrice: z.number().positive(),
  tpPrice: z.number().positive().nullable().optional(),
  entryType,
  entrySignal,
  entryDate: isoDate,
  earningsDate: isoDate, // required on create (manual entry, no auto-fetch)
  verifyDays,
}).refine((d) => d.slPrice < d.entryPrice, { message: 'slPrice must be below entryPrice', path: ['slPrice'] });

export const patchTradeSchema = z.object({
  ticker: z.string().min(1).max(10).transform((s) => s.toUpperCase()).optional(),
  upeti: z.number().positive().optional(),
  entryPrice: z.number().positive().optional(),
  slPrice: z.number().positive().optional(),
  tpPrice: z.number().positive().nullable().optional(),
  entryType: entryType.optional(),
  entrySignal: entrySignal.optional(),
  entryDate: isoDate.optional(),
  earningsDate: isoDate.optional(),
  verifyDays: verifyDays.optional(),
});

export const fillSchema = z.object({ fillDate: isoDate });
export const exitSchema = z.object({ exitPrice: z.number().positive(), exitDate: isoDate });
export const dudDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('keep') }),
  z.object({ decision: z.literal('exit'), exitPrice: z.number().positive(), exitDate: isoDate }),
]);

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type PatchTradeInput = z.infer<typeof patchTradeSchema>;
export type ExitInput = z.infer<typeof exitSchema>;
export type DudDecisionInput = z.infer<typeof dudDecisionSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/validation.ts src/server/validation.test.ts && git commit -m "feat: zod request validation schemas"
```

---

### Task 5: Repository layer (TDD)

**Files:**
- Create: `src/server/repository.ts`, `src/server/repository.test.ts`

**Interfaces:**
- Consumes: `DB` from `db/index.ts`, `trades`/`appSettings` from `db/schema.ts`, calc/types from `src/lib`, validation input types.
- Produces a `TradeRepo` (factory `createRepo(db: DB, now: () => string)`):
  - `create(input: CreateTradeInput): TradeRow` (status pending; sets timestamps; also `setLastUpeti`)
  - `list(status: 'pending' | 'filled'): TradeRow[]`
  - `history(year: number, cursor: string | null, limit: number): { items: TradeRow[]; nextCursor: string | null }` (order exit_date DESC, id DESC; composite cursor `"<exitDate>|<id>"`)
  - `years(): number[]` (distinct exit years, desc)
  - `getById(id: number): TradeRow | undefined`
  - `patch(id: number, input: PatchTradeInput): TradeRow` (throws `NotFound`)
  - `fill(id: number, fillDate: string): TradeRow` (throws `Conflict` unless status pending → filled)
  - `cancel(id: number): void` (throws `Conflict` unless pending; hard delete)
  - `exit(id: number, exitPrice: number, exitDate: string): TradeRow` (throws `Conflict` unless filled → exited)
  - `dudKeep(id: number): TradeRow` (filled only; sets dudDecision 'keep')
  - `getLastUpeti(): number | null` / `setLastUpeti(v: number): void`
- Error classes `NotFoundError`, `ConflictError` exported for routes to map to 404/409.

- [ ] **Step 1: Write failing tests `src/server/repository.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrateDb, type DB } from './db/index';
import { createRepo, NotFoundError, ConflictError } from './repository';

function setup() {
  const { db } = createDb(':memory:');
  migrateDb(db);
  let clock = '2026-08-03T00:00:00Z';
  const repo = createRepo(db, () => clock);
  return { repo, setClock: (c: string) => (clock = c) };
}

const base = { ticker: 'aapl', upeti: 1000, entryPrice: 50, slPrice: 45, entryType: 'buy_limit' as const, entrySignal: 'btb' as const, entryDate: '2026-08-03', earningsDate: '2026-08-25', verifyDays: 5 as const };

describe('create + lifecycle', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('creates pending and remembers upeti', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    expect(t.status).toBe('pending');
    expect(ctx.repo.getLastUpeti()).toBe(1000);
  });

  it('fill then exit moves to history', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    ctx.repo.fill(t.id, '2026-08-04');
    expect(ctx.repo.getById(t.id)!.status).toBe('filled');
    ctx.repo.exit(t.id, 55, '2026-08-20');
    const done = ctx.repo.getById(t.id)!;
    expect(done.status).toBe('exited');
    expect(done.exitPrice).toBe(55);
  });

  it('cancel deletes a pending order', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    ctx.repo.cancel(t.id);
    expect(ctx.repo.getById(t.id)).toBeUndefined();
  });

  it('cannot cancel a filled order', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    ctx.repo.fill(t.id, '2026-08-04');
    expect(() => ctx.repo.cancel(t.id)).toThrow(ConflictError);
  });

  it('cannot exit a pending order', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    expect(() => ctx.repo.exit(t.id, 55, '2026-08-20')).toThrow(ConflictError);
  });

  it('patch throws NotFound for missing id', () => {
    expect(() => ctx.repo.patch(999, { upeti: 5 })).toThrow(NotFoundError);
  });
});

describe('history + years', () => {
  const mkExited = (repo: ReturnType<typeof createRepo>, exitDate: string) => {
    const t = repo.create({ ...base, ticker: 'AAPL' });
    repo.fill(t.id, '2025-01-02');
    repo.exit(t.id, 55, exitDate);
    return t.id;
  };

  it('filters by exit year, newest first, paginates (monotonic ids)', () => {
    const { repo } = setup();
    mkExited(repo, '2025-03-01'); mkExited(repo, '2025-04-01'); mkExited(repo, '2025-05-01');
    const t2024 = repo.create({ ...base }); repo.fill(t2024.id, '2024-01-02'); repo.exit(t2024.id, 55, '2024-06-01');

    expect(repo.years()).toEqual([2025, 2024]);
    const page1 = repo.history(2025, null, 2);
    expect(page1.items.map((i) => i.exitDate)).toEqual(['2025-05-01', '2025-04-01']);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = repo.history(2025, page1.nextCursor, 2);
    expect(page2.items.map((i) => i.exitDate)).toEqual(['2025-03-01']);
    expect(page2.nextCursor).toBeNull();
  });

  // Critical: ids and exit_dates in OPPOSITE order. An id-only cursor would
  // drop/duplicate rows here. Paging must walk every row exactly once.
  it('paginates correctly when id order and exit_date order diverge', () => {
    const { repo } = setup();
    // id1 exits latest, id5 exits earliest — fully non-monotonic
    const id1 = mkExited(repo, '2025-05-01'); // id 1, newest exit
    const id2 = mkExited(repo, '2025-04-01'); // id 2
    const id3 = mkExited(repo, '2025-03-01'); // id 3
    const id4 = mkExited(repo, '2025-02-01'); // id 4
    const id5 = mkExited(repo, '2025-01-01'); // id 5, oldest exit
    void id1; void id2; void id3; void id4; void id5;

    // Walk all pages, collect ids, assert no dupes and no drops.
    const seen: number[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page = repo.history(2025, cursor, 2);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      if (++guard > 10) throw new Error('pagination did not terminate');
    } while (cursor !== null);

    // newest-exit first => id1..id5 in that order, every row exactly once
    expect(seen).toEqual([id1, id2, id3, id4, id5]);
    expect(new Set(seen).size).toBe(5); // no duplicates
  });

  it('returns empty page and null cursor for a year with no trades', () => {
    const { repo } = setup();
    const page = repo.history(2099, null, 50);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/repository.ts`**

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DB } from './db/index';
import { trades, appSettings } from './db/schema';
import type { TradeRow } from '../lib/types';
import type { CreateTradeInput, PatchTradeInput } from './validation';

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export interface TradeRepo {
  create(input: CreateTradeInput): TradeRow;
  list(status: 'pending' | 'filled'): TradeRow[];
  history(year: number, cursor: string | null, limit: number): { items: TradeRow[]; nextCursor: string | null };
  years(): number[];
  getById(id: number): TradeRow | undefined;
  patch(id: number, input: PatchTradeInput): TradeRow;
  fill(id: number, fillDate: string): TradeRow;
  cancel(id: number): void;
  exit(id: number, exitPrice: number, exitDate: string): TradeRow;
  dudKeep(id: number): TradeRow;
  getLastUpeti(): number | null;
  setLastUpeti(v: number): void;
}

export function createRepo(db: DB, now: () => string): TradeRepo {
  const require = (id: number): TradeRow => {
    const row = db.select().from(trades).where(eq(trades.id, id)).get() as TradeRow | undefined;
    if (!row) throw new NotFoundError(`trade ${id} not found`);
    return row;
  };

  return {
    create(input) {
      const ts = now();
      const row = db.insert(trades).values({
        ticker: input.ticker, upeti: input.upeti, entryPrice: input.entryPrice, slPrice: input.slPrice,
        tpPrice: input.tpPrice ?? null, entryType: input.entryType, entrySignal: input.entrySignal,
        entryDate: input.entryDate, earningsDate: input.earningsDate, verifyDays: input.verifyDays, status: 'pending',
        fillDate: null, dudDecision: null, exitPrice: null, exitDate: null, createdAt: ts, updatedAt: ts,
      }).returning().get() as TradeRow;
      this.setLastUpeti(input.upeti);
      return row;
    },
    list(status) {
      return db.select().from(trades).where(eq(trades.status, status)).orderBy(desc(trades.id)).all() as TradeRow[];
    },
    history(year, cursor, limit) {
      const y = String(year);
      const conds = [eq(trades.status, 'exited'), sql`substr(${trades.exitDate},1,4) = ${y}`];
      // Composite keyset cursor "<exitDate>|<id>": rows strictly "after" the
      // boundary in (exit_date DESC, id DESC) order. Splitting on the FIRST '|'
      // keeps the id intact even though exitDate never contains '|'.
      if (cursor !== null) {
        const sep = cursor.indexOf('|');
        const cExit = cursor.slice(0, sep);
        const cId = Number(cursor.slice(sep + 1));
        conds.push(sql`(${trades.exitDate} < ${cExit} or (${trades.exitDate} = ${cExit} and ${trades.id} < ${cId}))`);
      }
      const rows = db.select().from(trades).where(and(...conds))
        .orderBy(desc(trades.exitDate), desc(trades.id)).limit(limit + 1).all() as TradeRow[];
      const items = rows.slice(0, limit);
      const last = items[items.length - 1];
      const nextCursor = rows.length > limit && last ? `${last.exitDate}|${last.id}` : null;
      return { items, nextCursor };
    },
    years() {
      const rows = db.select({ y: sql<string>`substr(${trades.exitDate},1,4)` }).from(trades)
        .where(eq(trades.status, 'exited')).groupBy(sql`substr(${trades.exitDate},1,4)`).all();
      return rows.map((r) => Number(r.y)).sort((a, b) => b - a);
    },
    getById(id) {
      return db.select().from(trades).where(eq(trades.id, id)).get() as TradeRow | undefined;
    },
    patch(id, input) {
      require(id);
      db.update(trades).set({ ...input, updatedAt: now() }).where(eq(trades.id, id)).run();
      return require(id);
    },
    fill(id, fillDate) {
      const t = require(id);
      if (t.status !== 'pending') throw new ConflictError('only pending orders can be filled');
      db.update(trades).set({ status: 'filled', fillDate, updatedAt: now() }).where(eq(trades.id, id)).run();
      return require(id);
    },
    cancel(id) {
      const t = require(id);
      if (t.status !== 'pending') throw new ConflictError('only pending orders can be cancelled');
      db.delete(trades).where(eq(trades.id, id)).run();
    },
    exit(id, exitPrice, exitDate) {
      const t = require(id);
      if (t.status !== 'filled') throw new ConflictError('only filled positions can be exited');
      db.update(trades).set({ status: 'exited', exitPrice, exitDate, updatedAt: now() }).where(eq(trades.id, id)).run();
      return require(id);
    },
    dudKeep(id) {
      const t = require(id);
      if (t.status !== 'filled') throw new ConflictError('only filled positions can be kept');
      db.update(trades).set({ dudDecision: 'keep', updatedAt: now() }).where(eq(trades.id, id)).run();
      return require(id);
    },
    getLastUpeti() {
      const r = db.select().from(appSettings).where(eq(appSettings.key, 'last_upeti')).get();
      return r ? Number(r.value) : null;
    },
    setLastUpeti(v) {
      db.insert(appSettings).values({ key: 'last_upeti', value: String(v) })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: String(v) } }).run();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/repository.ts src/server/repository.test.ts && git commit -m "feat: trade repository with lifecycle and pagination"
```

---

### Task 6: Hono routes + app factory (TDD)

**Files:**
- Create: `src/server/app.ts`, `src/server/routes.ts`, `src/server/routes.test.ts`

**Interfaces:**
- Consumes: repo, validation schemas, `deriveTrade` from calc.
- Produces:
  - `buildApp(deps: { repo: TradeRepo; now: () => string }): Hono` mounting routes under `/api`.
  - Response shape: trades returned as `TradeDTO` (via `deriveTrade(row, todayISO)` where `todayISO = now().slice(0,10)`).
  - Endpoints exactly per spec (Task references API table). Error mapping: `ZodError`→400 `{ error, issues }`; `NotFoundError`→404; `ConflictError`→409.
  - `GET /api/summary?year` returns `{ totalPnl, totalR, tradeCount, winRate, equityCurve }` computed from `repo.history(year, null, <all>)` — fetch all exited for year (loop pages until nextCursor null) then compute in JS using calc.

- [ ] **Step 1: Write failing tests `src/server/routes.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrateDb } from './db/index';
import { createRepo } from './repository';
import { buildApp } from './app';

function setup() {
  const { db } = createDb(':memory:');
  migrateDb(db);
  let clock = '2026-08-10T00:00:00Z';
  const repo = createRepo(db, () => clock);
  const app = buildApp({ repo, now: () => clock });
  return { app, repo, setClock: (c: string) => (clock = c) };
}

const body = { ticker: 'aapl', upeti: 1000, entryPrice: 50, slPrice: 45, entryType: 'buy_limit', entrySignal: 'btb', entryDate: '2026-08-03', earningsDate: '2026-08-25', verifyDays: 5 };

describe('POST /api/trades', () => {
  it('creates and returns a derived DTO', async () => {
    const { app } = setup();
    const res = await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    const t = await res.json();
    expect(t.ticker).toBe('AAPL');
    expect(t.shares).toBe(200);
    expect(t.status).toBe('pending');
  });
  it('rejects invalid body with 400', async () => {
    const { app } = setup();
    const res = await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, slPrice: 60 }) });
    expect(res.status).toBe(400);
  });
});

describe('lifecycle endpoints', () => {
  it('fill -> exit and appears in history/summary', async () => {
    const { app } = setup();
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04' }) });
    await app.request(`/api/trades/${created.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });

    const hist = await (await app.request('/api/trades/history?year=2026&limit=50')).json();
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0].realizedPnl).toBe(1000);

    const summary = await (await app.request('/api/summary?year=2026')).json();
    expect(summary.totalPnl).toBe(1000);
    expect(summary.tradeCount).toBe(1);
    expect(summary.winRate).toBe(1);
    expect(summary.equityCurve).toEqual([{ exitDate: '2026-08-20', cumulativePnl: 1000 }]);
  });

  it('exit on pending returns 409', async () => {
    const { app } = setup();
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const res = await app.request(`/api/trades/${created.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/trades?status=filled includes dud flag', () => {
  it('flags after verify window', async () => {
    const { app } = setup(); // clock 2026-08-10
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-03' }) });
    const filled = await (await app.request('/api/trades?status=filled')).json();
    // 2026-08-03 Mon -> 2026-08-10 Mon = 5 weekdays >= 5
    expect(filled[0].dudFlagged).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/routes.test.ts`
Expected: FAIL — `app.ts` not found.

- [ ] **Step 3: Implement `src/server/routes.ts` and `src/server/app.ts`**

`src/server/routes.ts`:
```ts
import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { TradeRepo } from './repository';
import { NotFoundError, ConflictError } from './repository';
import { createTradeSchema, patchTradeSchema, fillSchema, exitSchema, dudDecisionSchema } from './validation';
import { deriveTrade, computePnl, computeShares, computeR } from '../lib/calc';
import type { TradeRow } from '../lib/types';

export interface Deps { repo: TradeRepo; now: () => string; }

export function registerRoutes(api: Hono, { repo, now }: Deps): void {
  const today = () => now().slice(0, 10);
  const dto = (row: TradeRow) => deriveTrade(row, today());

  api.get('/trades', (c) => {
    const status = c.req.query('status');
    if (status !== 'pending' && status !== 'filled') return c.json({ error: 'status must be pending or filled' }, 400);
    return c.json(repo.list(status).map(dto));
  });

  api.get('/trades/history', (c) => {
    const year = Number(c.req.query('year'));
    const limit = Number(c.req.query('limit') ?? '50');
    const cursorRaw = c.req.query('cursor');
    const cursor = cursorRaw ? cursorRaw : null;
    if (!Number.isInteger(year)) return c.json({ error: 'year required' }, 400);
    const { items, nextCursor } = repo.history(year, cursor, limit);
    return c.json({ items: items.map(dto), nextCursor });
  });

  api.get('/years', (c) => c.json(repo.years()));

  api.get('/summary', (c) => {
    const year = Number(c.req.query('year'));
    if (!Number.isInteger(year)) return c.json({ error: 'year required' }, 400);
    // gather all exited for year
    const all: TradeRow[] = [];
    let cursor: string | null = null;
    do {
      const page = repo.history(year, cursor, 500);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    // ascending for cumulative
    const asc = [...all].sort((a, b) => a.exitDate!.localeCompare(b.exitDate!) || a.id - b.id);
    let cum = 0;
    const equityCurve = asc.map((r) => {
      const shares = computeShares(r.upeti, r.entryPrice, r.slPrice);
      cum += computePnl(r.entryPrice, r.exitPrice as number, shares);
      return { exitDate: r.exitDate as string, cumulativePnl: cum };
    });
    const totalPnl = equityCurve.length ? equityCurve[equityCurve.length - 1]!.cumulativePnl : 0;
    const totalR = asc.reduce((s, r) => {
      const shares = computeShares(r.upeti, r.entryPrice, r.slPrice);
      return s + computeR(computePnl(r.entryPrice, r.exitPrice as number, shares), r.upeti);
    }, 0);
    const wins = asc.filter((r) => {
      const shares = computeShares(r.upeti, r.entryPrice, r.slPrice);
      return computePnl(r.entryPrice, r.exitPrice as number, shares) > 0;
    }).length;
    const tradeCount = asc.length;
    return c.json({ totalPnl, totalR, tradeCount, winRate: tradeCount ? wins / tradeCount : 0, equityCurve });
  });

  api.post('/trades', async (c) => {
    const input = createTradeSchema.parse(await c.req.json());
    return c.json(dto(repo.create(input)), 201);
  });

  api.patch('/trades/:id', async (c) => {
    const input = patchTradeSchema.parse(await c.req.json());
    return c.json(dto(repo.patch(Number(c.req.param('id')), input)));
  });

  api.post('/trades/:id/fill', async (c) => {
    const { fillDate } = fillSchema.parse(await c.req.json());
    return c.json(dto(repo.fill(Number(c.req.param('id')), fillDate)));
  });

  api.post('/trades/:id/cancel', (c) => {
    repo.cancel(Number(c.req.param('id')));
    return c.body(null, 204);
  });

  api.post('/trades/:id/exit', async (c) => {
    const { exitPrice, exitDate } = exitSchema.parse(await c.req.json());
    return c.json(dto(repo.exit(Number(c.req.param('id')), exitPrice, exitDate)));
  });

  api.post('/trades/:id/dud-decision', async (c) => {
    const input = dudDecisionSchema.parse(await c.req.json());
    const id = Number(c.req.param('id'));
    if (input.decision === 'keep') return c.json(dto(repo.dudKeep(id)));
    return c.json(dto(repo.exit(id, input.exitPrice, input.exitDate)));
  });

  api.get('/settings', (c) => c.json({ lastUpeti: repo.getLastUpeti() }));
}

export function errorHandler(err: Error, c: import('hono').Context) {
  if (err instanceof ZodError) return c.json({ error: 'validation', issues: err.issues }, 400);
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
  return c.json({ error: 'internal error' }, 500);
}
```

`src/server/app.ts`:
```ts
import { Hono } from 'hono';
import { registerRoutes, errorHandler, type Deps } from './routes';

export function buildApp(deps: Deps): Hono {
  const app = new Hono();
  const api = new Hono();
  registerRoutes(api, deps);
  app.route('/api', api);
  app.onError(errorHandler);
  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts src/server/routes.ts src/server/routes.test.ts && git commit -m "feat: hono api routes with summary and error mapping"
```

---

### Task 7: Server entry (node-server + static serving)

**Files:**
- Create: `src/server/index.ts`

**Interfaces:**
- Consumes: `buildApp`, `createDb`, `migrateDb`, `createRepo`.
- Produces: a running server on port 3000. In production serves `dist/` static files with SPA fallback to `index.html`.

- [ ] **Step 1: Implement `src/server/index.ts`**

```ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createDb, migrateDb } from './db/index';
import { createRepo } from './repository';
import { buildApp } from './app';

const { db } = createDb(process.env.DB_PATH ?? './trading.db');
migrateDb(db);
const repo = createRepo(db, () => new Date().toISOString());
const app = buildApp({ repo, now: () => new Date().toISOString() });

if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('/*', serveStatic({ path: './dist/index.html' }));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => console.log(`Trading Journal on http://localhost:${info.port}`));
```

- [ ] **Step 2: Verify dev server boots**

Run: `npm run dev:server`
Expected: logs `Trading Journal on http://localhost:3000`. Then in another shell: `curl -s "http://localhost:3000/api/years"` → `[]`. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts && git commit -m "feat: server entry with static serving"
```

---

### Task 8: Client API layer & QueryClient

**Files:**
- Modify: `src/client/main.tsx`
- Create: `src/client/api.ts`

**Interfaces:**
- Produces typed fetch helpers returning `TradeDTO`/summary types, and wires `QueryClientProvider`. `App` imported (created in Task 12; use a placeholder `App` now and flesh out later — but to avoid a missing import, create `src/client/App.tsx` minimal here).

- [ ] **Step 1: Create `src/client/api.ts`**

```ts
import type { TradeDTO } from '../lib/types';

export interface Summary {
  totalPnl: number; totalR: number; tradeCount: number; winRate: number;
  equityCurve: { exitDate: string; cumulativePnl: number }[];
}
export interface HistoryPage { items: TradeDTO[]; nextCursor: string | null; }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}
const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

export const api = {
  years: () => fetch('/api/years').then(json<number[]>),
  summary: (year: number) => fetch(`/api/summary?year=${year}`).then(json<Summary>),
  open: (status: 'pending' | 'filled') => fetch(`/api/trades?status=${status}`).then(json<TradeDTO[]>),
  history: (year: number, cursor: string | null, limit = 50) =>
    fetch(`/api/trades/history?year=${year}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).then(json<HistoryPage>),
  settings: () => fetch('/api/settings').then(json<{ lastUpeti: number | null }>),
  create: (b: unknown) => post('/api/trades', b).then(json<TradeDTO>),
  patch: (id: number, b: unknown) => fetch(`/api/trades/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(json<TradeDTO>),
  fill: (id: number, fillDate: string) => post(`/api/trades/${id}/fill`, { fillDate }).then(json<TradeDTO>),
  cancel: (id: number) => post(`/api/trades/${id}/cancel`).then((r) => { if (!r.ok) throw new Error('cancel failed'); }),
  exit: (id: number, exitPrice: number, exitDate: string) => post(`/api/trades/${id}/exit`, { exitPrice, exitDate }).then(json<TradeDTO>),
  dudDecision: (id: number, b: unknown) => post(`/api/trades/${id}/dud-decision`, b).then(json<TradeDTO>),
};
```

- [ ] **Step 2: Create minimal `src/client/App.tsx`**

```tsx
export default function App() {
  return <div className="p-6 text-slate-100">Trading Journal</div>;
}
```

- [ ] **Step 3: Update `src/client/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Verify typecheck/build**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/client && git commit -m "feat: client api layer and query provider"
```

---

### Task 9: SignalPill component

**Files:**
- Create: `src/client/components/SignalPill.tsx`

**Interfaces:**
- Produces: `SignalPill({ signal }: { signal: EntrySignal })` and exported `SIGNAL_LABELS`, `SIGNAL_CLASSES` maps.

- [ ] **Step 1: Implement `src/client/components/SignalPill.tsx`**

```tsx
import type { EntrySignal } from '../../lib/types';

export const SIGNAL_LABELS: Record<EntrySignal, string> = {
  btb: 'BTB', buy_lautan: 'Buy Lautan', buy_magenta: 'Buy Magenta', hawk1: 'Hawk1', buy_spec: 'Buy Spec',
};

// green / light blue / magenta / dark green / pink
export const SIGNAL_CLASSES: Record<EntrySignal, string> = {
  btb: 'bg-green-500/20 text-green-300 ring-green-500/40',
  buy_lautan: 'bg-sky-400/20 text-sky-200 ring-sky-400/40',
  buy_magenta: 'bg-fuchsia-500/20 text-fuchsia-200 ring-fuchsia-500/40',
  hawk1: 'bg-green-800/30 text-green-200 ring-green-700/50',
  buy_spec: 'bg-pink-400/20 text-pink-200 ring-pink-400/40',
};

export function SignalPill({ signal }: { signal: EntrySignal }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${SIGNAL_CLASSES[signal]}`}>
      {SIGNAL_LABELS[signal]}
    </span>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/SignalPill.tsx && git commit -m "feat: signal pill component"
```

---

### Task 10: Yearly summary (StatTiles, EquityChart, YearSelector)

**Files:**
- Create: `src/client/components/YearSelector.tsx`, `src/client/components/StatTiles.tsx`, `src/client/components/EquityChart.tsx`

**Interfaces:**
- Consumes: `api.years`, `api.summary`, `Summary` type.
- Produces:
  - `YearSelector({ years, selected, onSelect })`
  - `StatTiles({ summary })` — Total P&L (green/red), Total R, Trade count, Win rate (%).
  - `EquityChart({ data })` — Recharts line/area of `cumulativePnl` vs `exitDate`, zero reference line.

- [ ] **Step 1: Implement `YearSelector.tsx`**

```tsx
export function YearSelector({ years, selected, onSelect }: { years: number[]; selected: number | null; onSelect: (y: number) => void }) {
  if (years.length === 0) return <span className="text-slate-400 text-sm">No exited trades yet</span>;
  return (
    <div className="inline-flex rounded-lg bg-slate-800 p-1">
      {years.map((y) => (
        <button key={y} onClick={() => onSelect(y)}
          className={`px-3 py-1 text-sm rounded-md ${y === selected ? 'bg-slate-100 text-slate-900' : 'text-slate-300'}`}>
          {y}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement `StatTiles.tsx`**

```tsx
import type { Summary } from '../api';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function StatTiles({ summary }: { summary: Summary }) {
  const pnlColor = summary.totalPnl > 0 ? 'text-green-400' : summary.totalPnl < 0 ? 'text-red-400' : 'text-slate-200';
  const tiles = [
    { label: 'Realized P&L', value: money(summary.totalPnl), cls: pnlColor },
    { label: 'Total R', value: `${summary.totalR >= 0 ? '+' : ''}${summary.totalR.toFixed(2)}R`, cls: 'text-slate-100' },
    { label: 'Trades', value: String(summary.tradeCount), cls: 'text-slate-100' },
    { label: 'Win rate', value: `${(summary.winRate * 100).toFixed(0)}%`, cls: 'text-slate-100' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl bg-slate-800/60 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">{t.label}</div>
          <div className={`mt-1 text-2xl font-semibold ${t.cls}`}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implement `EquityChart.tsx`**

```tsx
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Summary } from '../api';

export function EquityChart({ data }: { data: Summary['equityCurve'] }) {
  if (data.length === 0) return <div className="h-48 grid place-items-center text-slate-500 text-sm">No data for this year</div>;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pnl" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="exitDate" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={24} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
          <ReferenceLine y={0} stroke="#475569" />
          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
          <Area type="monotone" dataKey="cumulativePnl" stroke="#34d399" fill="url(#pnl)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/YearSelector.tsx src/client/components/StatTiles.tsx src/client/components/EquityChart.tsx && git commit -m "feat: yearly summary components"
```

---

### Task 11: Trade form, exit form, plan tables

**Files:**
- Create: `src/client/components/TradeForm.tsx`, `src/client/components/ExitForm.tsx`, `src/client/components/PlanTables.tsx`

**Interfaces:**
- Consumes: `api`, `computeShares` from calc, `SignalPill`, mutations via TanStack Query.
- Produces:
  - `TradeForm({ open, onClose })` — modal; create trade; prefill UPETI from `api.settings`; live shares preview; entry date default today; verify-days select.
  - `ExitForm({ trade, onClose })` — modal; exit price + date (default today).
  - `PlanTables()` — Pending Orders section (Mark Filled / Cancel / Edit) and Active Positions section (Exit / Keep-or-Exit when `dudFlagged`, red highlight).

- [ ] **Step 1: Implement `ExitForm.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { TradeDTO } from '../../lib/types';

const todayISO = () => new Date().toISOString().slice(0, 10);

export function ExitForm({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const [exitPrice, setExitPrice] = useState('');
  const [exitDate, setExitDate] = useState(todayISO());
  const m = useMutation({
    mutationFn: () => api.exit(trade.id, Number(exitPrice), exitDate),
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
  });
  return (
    <Modal onClose={onClose} title={`Exit ${trade.ticker}`}>
      <label className="block text-sm">Exit price
        <input type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" />
      </label>
      <label className="block text-sm mt-3">Exit date
        <input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1 rounded bg-slate-600">Cancel</button>
        <button disabled={!exitPrice || m.isPending} onClick={() => m.mutate()} className="px-3 py-1 rounded bg-emerald-600 disabled:opacity-50">Confirm exit</button>
      </div>
    </Modal>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-slate-800 p-5 text-slate-100" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `TradeForm.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { computeShares } from '../../lib/calc';
import { SIGNAL_LABELS } from './SignalPill';
import type { EntrySignal, EntryType } from '../../lib/types';
import { Modal } from './ExitForm';

const todayISO = () => new Date().toISOString().slice(0, 10);
const SIGNALS = Object.keys(SIGNAL_LABELS) as EntrySignal[];

export function TradeForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [ticker, setTicker] = useState('');
  const [upeti, setUpeti] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [tpPrice, setTpPrice] = useState('');
  const [entryType, setEntryType] = useState<EntryType>('buy_limit');
  const [entrySignal, setEntrySignal] = useState<EntrySignal>('btb');
  const [entryDate, setEntryDate] = useState(todayISO());
  const [earningsDate, setEarningsDate] = useState('');
  const [verifyDays, setVerifyDays] = useState(5);

  useEffect(() => { if (settings.data?.lastUpeti != null) setUpeti(String(settings.data.lastUpeti)); }, [settings.data]);

  const shares = (() => {
    const u = Number(upeti), e = Number(entryPrice), s = Number(slPrice);
    return u > 0 && e > s && s > 0 ? computeShares(u, e, s) : 0;
  })();

  const m = useMutation({
    mutationFn: () => api.create({
      ticker, upeti: Number(upeti), entryPrice: Number(entryPrice), slPrice: Number(slPrice),
      tpPrice: tpPrice ? Number(tpPrice) : null, entryType, entrySignal, entryDate, earningsDate, verifyDays,
    }),
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
  });

  if (!open) return null;
  const valid = ticker && Number(upeti) > 0 && Number(entryPrice) > Number(slPrice) && Number(slPrice) > 0 && earningsDate;
  return (
    <Modal title="New Trade Plan" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Ticker<input value={ticker} onChange={(e) => setTicker(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" /></label>
        <label>UPETI (risk $)<input type="number" step="any" value={upeti} onChange={(e) => setUpeti(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" /></label>
        <label>Entry price<input type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" /></label>
        <label>SL price<input type="number" step="any" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" /></label>
        <label>TP price (optional)<input type="number" step="any" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" /></label>
        <label>Entry type<select value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1"><option value="buy_limit">Buy Limit</option><option value="buy_stop">Buy Stop</option></select></label>
        <label>Entry signal<select value={entrySignal} onChange={(e) => setEntrySignal(e.target.value as EntrySignal)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1">{SIGNALS.map((s) => <option key={s} value={s}>{SIGNAL_LABELS[s]}</option>)}</select></label>
        <label>Entry date<input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" /></label>
        <label>Earnings date<input type="date" value={earningsDate} onChange={(e) => setEarningsDate(e.target.value)} className="mt-1 w-full rounded bg-slate-700 px-2 py-1" /></label>
        <label>Verify in<select value={verifyDays} onChange={(e) => setVerifyDays(Number(e.target.value))} className="mt-1 w-full rounded bg-slate-700 px-2 py-1">{[5,7,10,14].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
      </div>
      <div className="mt-3 text-sm text-slate-300">Position size: <span className="font-semibold text-slate-100">{shares} shares</span></div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1 rounded bg-slate-600">Cancel</button>
        <button disabled={!valid || m.isPending} onClick={() => m.mutate()} className="px-3 py-1 rounded bg-emerald-600 disabled:opacity-50">Create plan</button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Implement `PlanTables.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { SignalPill } from './SignalPill';
import { ExitForm } from './ExitForm';
import type { TradeDTO } from '../../lib/types';

const todayISO = () => new Date().toISOString().slice(0, 10);
const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

function Row({ t, children, flagged }: { t: TradeDTO; children: React.ReactNode; flagged?: boolean }) {
  return (
    <tr className={flagged ? 'bg-red-900/40' : ''}>
      <td className="px-3 py-2 font-medium">{t.ticker}</td>
      <td className="px-3 py-2">{t.entryDate}</td>
      <td className="px-3 py-2">{t.earningsDate ?? '—'}</td>
      <td className="px-3 py-2">{money(t.entryPrice)}</td>
      <td className="px-3 py-2">{money(t.slPrice)}</td>
      <td className="px-3 py-2">{money(t.tpPrice)}</td>
      <td className="px-3 py-2">{t.shares}</td>
      <td className="px-3 py-2"><SignalPill signal={t.entrySignal} /></td>
      <td className="px-3 py-2">{children}</td>
    </tr>
  );
}

export function PlanTables() {
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: ['trades', 'pending'], queryFn: () => api.open('pending') });
  const filled = useQuery({ queryKey: ['trades', 'filled'], queryFn: () => api.open('filled') });
  const [exiting, setExiting] = useState<TradeDTO | null>(null);
  const inval = () => qc.invalidateQueries();

  const fill = useMutation({ mutationFn: (id: number) => api.fill(id, todayISO()), onSuccess: inval });
  const cancel = useMutation({ mutationFn: (id: number) => api.cancel(id), onSuccess: inval });
  const keep = useMutation({ mutationFn: (id: number) => api.dudDecision(id, { decision: 'keep' }), onSuccess: inval });

  const th = 'px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400';
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Pending Orders</h2>
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Ticker</th><th className={th}>Entry date</th><th className={th}>Earnings</th><th className={th}>Entry</th><th className={th}>SL</th><th className={th}>TP</th><th className={th}>Shares</th><th className={th}>Signal</th><th className={th}>Actions</th></tr></thead>
          <tbody>
            {pending.data?.map((t) => (
              <Row key={t.id} t={t}>
                <span className="flex gap-2">
                  <button onClick={() => fill.mutate(t.id)} className="rounded bg-emerald-600 px-2 py-0.5 text-xs">Mark filled</button>
                  <button onClick={() => cancel.mutate(t.id)} className="rounded bg-slate-600 px-2 py-0.5 text-xs">Cancel</button>
                </span>
              </Row>
            ))}
            {pending.data?.length === 0 && <tr><td colSpan={9} className="px-3 py-3 text-slate-500">No pending orders</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Active Positions</h2>
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Ticker</th><th className={th}>Entry date</th><th className={th}>Earnings</th><th className={th}>Entry</th><th className={th}>SL</th><th className={th}>TP</th><th className={th}>Shares</th><th className={th}>Signal</th><th className={th}>Actions</th></tr></thead>
          <tbody>
            {filled.data?.map((t) => (
              <Row key={t.id} t={t} flagged={t.dudFlagged}>
                {t.dudFlagged ? (
                  <span className="flex items-center gap-2">
                    <span className="rounded bg-red-500 px-2 py-0.5 text-xs font-semibold">Verify</span>
                    <button onClick={() => keep.mutate(t.id)} className="rounded bg-slate-600 px-2 py-0.5 text-xs">Keep</button>
                    <button onClick={() => setExiting(t)} className="rounded bg-red-600 px-2 py-0.5 text-xs">Exit</button>
                  </span>
                ) : (
                  <button onClick={() => setExiting(t)} className="rounded bg-slate-600 px-2 py-0.5 text-xs">Exit</button>
                )}
              </Row>
            ))}
            {filled.data?.length === 0 && <tr><td colSpan={9} className="px-3 py-3 text-slate-500">No active positions</td></tr>}
          </tbody>
        </table>
      </section>

      {exiting && <ExitForm trade={exiting} onClose={() => setExiting(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/TradeForm.tsx src/client/components/ExitForm.tsx src/client/components/PlanTables.tsx && git commit -m "feat: trade/exit forms and plan tables"
```

---

### Task 12: History table (infinite scroll) & App composition

**Files:**
- Create: `src/client/components/HistoryTable.tsx`
- Modify: `src/client/App.tsx`

**Interfaces:**
- Consumes: `api.history` (`useInfiniteQuery`), IntersectionObserver sentinel, all summary/plan components.
- Produces: `HistoryTable({ year })`; final `App` composing header (title, YearSelector, New Trade button), summary, plan tables, history.

- [ ] **Step 1: Implement `HistoryTable.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api';
import { SignalPill } from './SignalPill';

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

export function HistoryTable({ year }: { year: number }) {
  const q = useInfiniteQuery({
    queryKey: ['history', year],
    queryFn: ({ pageParam }) => api.history(year, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const sentinel = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!sentinel.current) return;
    const obs = new IntersectionObserver((e) => { if (e[0]!.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); });
    obs.observe(sentinel.current);
    return () => obs.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q]);

  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const th = 'px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400';
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-300">Trading History</h2>
      <table className="w-full text-sm">
        <thead><tr>
          <th className={th}>Ticker</th><th className={th}>Entry date</th><th className={th}>Entry</th><th className={th}>SL</th><th className={th}>TP</th>
          <th className={th}>Exit date</th><th className={th}>Exit</th><th className={th}>Signal</th><th className={th}>Realized P&L</th>
        </tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t border-slate-800">
              <td className="px-3 py-2 font-medium">{t.ticker}</td>
              <td className="px-3 py-2">{t.entryDate}</td>
              <td className="px-3 py-2">{money(t.entryPrice)}</td>
              <td className="px-3 py-2">{money(t.slPrice)}</td>
              <td className="px-3 py-2">{money(t.tpPrice)}</td>
              <td className="px-3 py-2">{t.exitDate}</td>
              <td className="px-3 py-2">{money(t.exitPrice)}</td>
              <td className="px-3 py-2"><SignalPill signal={t.entrySignal} /></td>
              <td className={`px-3 py-2 font-semibold ${(t.realizedPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {money(t.realizedPnl)} <span className="text-xs text-slate-400">({t.rMultiple != null ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple.toFixed(2)}R` : '—'})</span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-3 text-slate-500">No trades for {year}</td></tr>}
          <tr ref={sentinel} />
        </tbody>
      </table>
      {q.isFetchingNextPage && <div className="py-3 text-center text-slate-500 text-sm">Loading…</div>}
    </section>
  );
}
```

- [ ] **Step 2: Implement final `src/client/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { YearSelector } from './components/YearSelector';
import { StatTiles } from './components/StatTiles';
import { EquityChart } from './components/EquityChart';
import { PlanTables } from './components/PlanTables';
import { HistoryTable } from './components/HistoryTable';
import { TradeForm } from './components/TradeForm';

export default function App() {
  const years = useQuery({ queryKey: ['years'], queryFn: api.years });
  const [year, setYear] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (year === null && years.data && years.data.length > 0) setYear(years.data[0]!);
  }, [years.data, year]);

  const summary = useQuery({ queryKey: ['summary', year], queryFn: () => api.summary(year!), enabled: year !== null });

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="mx-auto max-w-6xl p-6 space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Trading Journal</h1>
          <div className="flex items-center gap-3">
            <YearSelector years={years.data ?? []} selected={year} onSelect={setYear} />
            <button onClick={() => setFormOpen(true)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium">+ New Trade Plan</button>
          </div>
        </header>

        {year !== null && summary.data && (
          <section className="space-y-4">
            <StatTiles summary={summary.data} />
            <div className="rounded-xl bg-slate-800/40 p-4"><EquityChart data={summary.data.equityCurve} /></div>
          </section>
        )}

        <PlanTables />

        {year !== null && <HistoryTable year={year} />}

        <TradeForm open={formOpen} onClose={() => setFormOpen(false)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build + typecheck**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`. Open the Vite URL. Create a plan → appears under Pending. Mark filled → moves to Active. Exit with a price → disappears from Active, appears in History; year selector shows the year; summary + chart populate.

- [ ] **Step 5: Commit**

```bash
git add src/client && git commit -m "feat: history table with infinite scroll and full app layout"
```

---

### Task 13: Full test run & README

**Files:**
- Create: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all calc, validation, repository, routes tests PASS.

- [ ] **Step 2: Write `README.md`**

```markdown
# Trading Journal

Local single-user trading journal. Vite + React + Hono + SQLite (Drizzle) + Tailwind.

## Requirements
- Node.js 20+

## Setup
    npm install
    npm run db:generate   # first time only, if drizzle/ is empty
    npm run dev           # client (5173) + api (3000)

## Production
    npm run build
    npm start             # serves built client + api on :3000

Data lives in `trading.db` (gitignored).

## Concepts
- **UPETI**: risk amount ($). Shares = floor(UPETI / (entry − SL)).
- **Realized P&L** = (exit − entry) × shares (gross). **R** = P&L / UPETI.
- **Dud check**: a filled position flags red after `verifyDays` weekdays; Keep (stop flagging) or Exit.
- **Year view**: trades attribute to their exit-date year; chart is cumulative P&L.
```

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "docs: add README"
```

---

## Self-Review

**Spec coverage:**
- History table, 50/page, infinite scroll, latest first → Task 12 + repo pagination (Task 5) ✓
- Current plan tables, same columns → Task 11 (split pending/active per spec) ✓
- Create plan form (ticker, UPETI w/ memory, entry price, entry type, entry signal pills, entry date editable, verify-days dropdown) → Task 11 + settings memory Task 5 ✓
- SL/TP added to form → Task 11 ✓
- Dud verify: weekday count, red highlight, Keep/Exit, remind-until-decided, exit asks price+date → Tasks 2 (calc), 6 (dud-decision route), 11 (UI) ✓
- History columns (ticker, entry date, entry price, SL, TP, exit date, exit price, signal, realized P&L) → Task 12 ✓ (also R per spec)
- Yearly single-year selector, only years with data, summary total P&L + mini chart → Tasks 6 (years/summary), 10, 12 ✓
- No cross-year aggregation → summary/history filtered by single year ✓

**Placeholder scan:** No TBD/TODO; all code blocks concrete. Minimal `App.tsx` in Task 8 is intentionally replaced in Task 12 (noted).

**Type consistency:** `TradeDTO`, `Summary`, `HistoryPage`, repo method names, and route/api names are consistent across tasks. `deriveTrade(row, todayISO)` signature matches its use in routes. `Modal` exported from `ExitForm` and imported by `TradeForm`.
