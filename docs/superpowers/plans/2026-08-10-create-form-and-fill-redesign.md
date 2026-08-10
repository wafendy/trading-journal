# Create-Form & Fill Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move UPETI + Confirm-in to editable global settings, drop the create-form entry date (capturing a single fill date + required fill price at "Mark filled"), and lay the create form out in 3 columns.

**Architecture:** Server-side: drop the `entry_date` column, add nullable `fill_price`, extend `app_settings` with `upeti`/`verify_days` globals, and change P&L cost basis to the actual fill price. Client-side: header controls for the globals, a 3-column create form without UPETI/Confirm-in/entry-date, and a Mark-filled modal capturing fill date + price.

**Tech Stack:** existing — Hono, Drizzle/SQLite, Zod, TanStack Query, React, Vitest, Tailwind v4. No new dependencies.

## Global Constraints

- Node via **mise**: prefix every node/npm/npx command with `eval "$(mise activate zsh)" &&` — a plain shell has no `node` on PATH.
- **Do NOT commit anything.** Per project convention, application code AND docs/specs are kept **staged but uncommitted**. After each task run `git add -A` to STAGE only. Never `git commit` unless the user explicitly asks. (This overrides the generic "commit" step in any sub-skill.)
- TypeScript strict; no `any`.
- Shared money math lives in `src/lib/calc.ts` and is imported by both server and client — change it in one place only.
- `shares = floor(upeti / (entryPrice − slPrice))`, sized at creation from the **planned** entry price and never recomputed after fill.
- `realizedPnl = (exitPrice − costBasis) × shares` where `costBasis = fillPrice ?? entryPrice`.
- `R = realizedPnl / upeti`.
- UPETI and Confirm-in (verify days) are **per-trade snapshot columns** copied from globals at create time; changing a global never rewrites existing trades.
- Global defaults when unset: **UPETI 100**, **verifyDays 5**. `verifyDays ∈ {5,7,10,14}`.
- The dud-check runs off `fill_date` (unchanged).
- Tests: `calc`, `validation`, `repository`, `routes` have `*.test.ts` beside the source. UI (`src/client/`) is not unit-tested — verify UI via `npx tsc --noEmit` + `npm run build`.
- Run the full suite with `eval "$(mise activate zsh)" && npx vitest run`.

---

## File Structure

```
src/server/db/schema.ts        # drop entry_date, add fill_price (Task 1)
drizzle/000N_*.sql             # generated migration (Task 1)
src/lib/types.ts               # TradeRow: -entryDate, +fillPrice (Task 2)
src/lib/calc.ts                # deriveTrade cost-basis = fillPrice ?? entryPrice (Task 2)
src/lib/calc.test.ts           # cost-basis tests (Task 2)
src/server/validation.ts       # create: -entryDate; fillSchema +fillPrice; +settingsSchema (Task 3)
src/server/validation.test.ts  # validation tests (Task 3)
src/server/repository.ts       # fill(+fillPrice); getSettings/setSettings; create snapshots (Task 4)
src/server/repository.test.ts  # repo tests (Task 4)
src/server/routes.ts           # GET/PATCH /settings; fill passes fillPrice (Task 5)
src/server/routes.test.ts      # route tests (Task 5)
src/server/seed.ts             # drop entryDate, pass fillPrice, seed settings (Task 6)
src/client/api.ts              # settings shape + updateSettings; fill(+fillPrice) (Task 7)
src/client/App.tsx             # header settings controls (Task 7)
src/client/components/SettingsControls.tsx  # new: UPETI + Confirm-in header inputs (Task 7)
src/client/components/TradeForm.tsx         # 3-col layout, drop entryDate/upeti/verify (Task 8)
src/client/components/FillModal.tsx         # new: fill date + price modal (Task 9)
src/client/components/PlanTables.tsx        # use FillModal; show fillDate/price (Task 9)
src/client/components/HistoryTable.tsx      # entryDate -> fillDate (Task 10)
src/client/components/TradeDetails.tsx      # entry/fill rows (Task 10)
README.md / CLAUDE.md          # doc updates (Task 11)
```

Task order is server-first (schema → types/calc → validation → repo → routes → seed) so the client tasks build on a green server. Each task ends staged and with the full suite green.

---

### Task 1: Schema — drop `entry_date`, add `fill_price` + migration

**Files:**
- Modify: `src/server/db/schema.ts:12` (remove), `:17-18` area (add)
- Create: `drizzle/000N_*.sql` (generated)

**Interfaces:**
- Produces: `trades` table without `entry_date`, with nullable `fill_price REAL`.

- [ ] **Step 1: Edit `src/server/db/schema.ts`**

Remove this line:
```ts
  entryDate: text('entry_date').notNull(),
```
Add a `fillPrice` column next to `fillDate`:
```ts
  fillDate: text('fill_date'),
  fillPrice: real('fill_price'),
```
(`real` is already imported.)

- [ ] **Step 2: Generate the migration**

Run: `eval "$(mise activate zsh)" && npm run db:generate`
Expected: a new `drizzle/000N_*.sql` dropping `entry_date` and adding `fill_price`. Drizzle handles SQLite column drop/add via table rebuild.

- [ ] **Step 3: Verify migration applies on a fresh DB**

Run: `eval "$(mise activate zsh)" && DB_PATH=/tmp/tj-mig.db npx tsx -e "import {createDb,migrateDb} from './src/server/db/index'; const {db}=createDb(process.env.DB_PATH); migrateDb(db); console.log('migrated ok');" && rm -f /tmp/tj-mig.db*`
Expected: prints `migrated ok` with no error. (This is a temporary DB — deleted after.)

- [ ] **Step 4: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

Note: the suite will not be green until Task 2 updates `TradeRow`; that is expected within this sequence. Do not attempt to run vitest here.

---

### Task 2: Types + calc — `fillPrice` cost basis (TDD)

**Files:**
- Modify: `src/lib/types.ts:16` (remove entryDate), `:21` area (add fillPrice)
- Modify: `src/lib/calc.ts:41-47` (`deriveTrade`)
- Test: `src/lib/calc.test.ts`

**Interfaces:**
- Consumes: `TradeRow` from Task 1's schema shape.
- Produces:
  - `TradeRow` has `fillPrice: number | null`, no `entryDate`.
  - `deriveTrade(row, todayISO)` computes `realizedPnl` from `costBasis = row.fillPrice ?? row.entryPrice`.

- [ ] **Step 1: Update `src/lib/types.ts`**

In `TradeRow`, remove:
```ts
  entryDate: string;
```
And add after `fillDate`:
```ts
  fillDate: string | null;
  fillPrice: number | null;
```

- [ ] **Step 2: Write the failing test in `src/lib/calc.test.ts`**

Add this block (the file already imports `deriveTrade`, `TradeRow`):
```ts
describe('deriveTrade cost basis', () => {
  const base: TradeRow = {
    id: 1, ticker: 'AAPL', upeti: 1000, entryPrice: 50, slPrice: 45, tpPrice: null,
    entryType: 'buy_limit', entrySignal: 'btb', earningsDate: '2026-08-25', notes: null,
    verifyDays: 5, status: 'exited', fillDate: '2026-08-04', fillPrice: 52, dudDecision: null,
    exitPrice: 60, exitDate: '2026-08-20', createdAt: 'x', updatedAt: 'x',
  };
  it('uses fillPrice as cost basis when present', () => {
    // shares = floor(1000/(50-45)) = 200; pnl = (60-52)*200 = 1600
    const d = deriveTrade(base, '2026-08-21');
    expect(d.shares).toBe(200);
    expect(d.realizedPnl).toBe(1600);
  });
  it('falls back to entryPrice when fillPrice is null', () => {
    // pnl = (60-50)*200 = 2000
    const d = deriveTrade({ ...base, fillPrice: null }, '2026-08-21');
    expect(d.realizedPnl).toBe(2000);
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `eval "$(mise activate zsh)" && npx vitest run src/lib/calc.test.ts`
Expected: FAIL — either a type error on `fillPrice`/removed `entryDate`, or `realizedPnl` = 2000 (still using entryPrice) for the first test.

- [ ] **Step 4: Update `deriveTrade` in `src/lib/calc.ts`**

Replace the body of `deriveTrade` with:
```ts
export function deriveTrade(row: TradeRow, todayISO: string): TradeDTO {
  const shares = computeShares(row.upeti, row.entryPrice, row.slPrice);
  const exited = row.status === 'exited' && row.exitPrice !== null;
  const costBasis = row.fillPrice ?? row.entryPrice;
  const realizedPnl = exited ? computePnl(costBasis, row.exitPrice as number, shares) : null;
  const rMultiple = realizedPnl !== null ? computeR(realizedPnl, row.upeti) : null;
  return { ...row, shares, realizedPnl, rMultiple, dudFlagged: isDudFlagged(row, todayISO) };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `eval "$(mise activate zsh)" && npx vitest run src/lib/calc.test.ts`
Expected: PASS.

- [ ] **Step 6: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 3: Validation — drop entryDate, fillPrice, settingsSchema (TDD)

**Files:**
- Modify: `src/server/validation.ts`
- Test: `src/server/validation.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `createTradeSchema` no longer has `entryDate` (still requires `upeti`, `verifyDays`, `earningsDate`).
  - `fillSchema = { fillDate: isoDate, fillPrice: number.positive }`; `FillInput` updated.
  - `settingsSchema = { upeti?: number.positive, verifyDays?: 5|7|10|14 }`; `SettingsInput` exported.

- [ ] **Step 1: Add failing tests to `src/server/validation.test.ts`**

Update the import line to add `fillSchema, settingsSchema`:
```ts
import { createTradeSchema, patchTradeSchema, dudDecisionSchema, exitSchema, fillSchema, settingsSchema } from './validation';
```
Remove `entryDate` from the `valid` fixture in the existing `createTradeSchema` describe block (change `entryDate: '2026-08-03', earningsDate:` to just `earningsDate:`). Then add:
```ts
describe('fillSchema', () => {
  it('requires fillDate and positive fillPrice', () => {
    expect(fillSchema.parse({ fillDate: '2026-08-04', fillPrice: 52 })).toEqual({ fillDate: '2026-08-04', fillPrice: 52 });
    expect(() => fillSchema.parse({ fillDate: '2026-08-04' })).toThrow();
    expect(() => fillSchema.parse({ fillDate: '2026-08-04', fillPrice: 0 })).toThrow();
  });
});

describe('settingsSchema', () => {
  it('accepts partial updates', () => {
    expect(settingsSchema.parse({ upeti: 250 })).toEqual({ upeti: 250 });
    expect(settingsSchema.parse({ verifyDays: 7 })).toEqual({ verifyDays: 7 });
    expect(settingsSchema.parse({})).toEqual({});
  });
  it('rejects bad values', () => {
    expect(() => settingsSchema.parse({ upeti: -1 })).toThrow();
    expect(() => settingsSchema.parse({ verifyDays: 3 })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/validation.test.ts`
Expected: FAIL — `fillSchema`/`settingsSchema` don't have the new shape / aren't exported as expected.

- [ ] **Step 3: Edit `src/server/validation.ts`**

Remove `entryDate: isoDate,` from `createTradeSchema` and `entryDate: isoDate.optional(),` from `patchTradeSchema`.
Change the fill schema line to:
```ts
export const fillSchema = z.object({ fillDate: isoDate, fillPrice: z.number().positive() });
```
Add the settings schema (near the other schemas):
```ts
export const settingsSchema = z.object({
  upeti: z.number().positive().optional(),
  verifyDays: verifyDays.optional(),
});
```
Add the exported type near the others:
```ts
export type SettingsInput = z.infer<typeof settingsSchema>;
```

- [ ] **Step 4: Run to verify pass**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 4: Repository — fill(+fillPrice), settings accessors, create snapshot (TDD)

**Files:**
- Modify: `src/server/repository.ts`
- Test: `src/server/repository.test.ts`

**Interfaces:**
- Consumes: `SettingsInput` from Task 3; `TradeRow.fillPrice` from Task 2.
- Produces (on `TradeRepo`):
  - `fill(id: number, fillDate: string, fillPrice: number): TradeRow` — sets status filled, fillDate, fillPrice.
  - `getSettings(): { upeti: number; verifyDays: number }` — defaults `{ upeti: 100, verifyDays: 5 }`.
  - `setSettings(input: { upeti?: number; verifyDays?: number }): void` — upserts provided keys.
  - `getLastUpeti`/`setLastUpeti` are **removed**.
  - `create` no longer sets `entryDate` and no longer calls `setLastUpeti`.

- [ ] **Step 1: Update tests in `src/server/repository.test.ts`**

Remove `entryDate: '2026-08-03',` from the `base` fixture. Replace the assertion `expect(ctx.repo.getLastUpeti()).toBe(1000);` with a create-status check only:
```ts
  it('creates pending', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    expect(t.status).toBe('pending');
  });
```
Update every `ctx.repo.fill(t.id, '<date>')` call to pass a price, e.g. `ctx.repo.fill(t.id, '2026-08-04', 50)`.
Add new tests:
```ts
describe('fill captures price', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });
  it('persists fillDate and fillPrice', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    const f = ctx.repo.fill(t.id, '2026-08-04', 52);
    expect(f.status).toBe('filled');
    expect(f.fillDate).toBe('2026-08-04');
    expect(f.fillPrice).toBe(52);
  });
});

describe('settings', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });
  it('defaults when unset', () => {
    expect(ctx.repo.getSettings()).toEqual({ upeti: 100, verifyDays: 5 });
  });
  it('round-trips partial updates', () => {
    ctx.repo.setSettings({ upeti: 250 });
    expect(ctx.repo.getSettings()).toEqual({ upeti: 250, verifyDays: 5 });
    ctx.repo.setSettings({ verifyDays: 7 });
    expect(ctx.repo.getSettings()).toEqual({ upeti: 250, verifyDays: 7 });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/repository.test.ts`
Expected: FAIL — `fill` arity / `getSettings`/`setSettings` missing.

- [ ] **Step 3: Edit `src/server/repository.ts`**

In the `TradeRepo` interface: change `fill` and replace the settings methods:
```ts
  fill(id: number, fillDate: string, fillPrice: number): TradeRow;
  cancel(id: number): void;
  exit(id: number, exitPrice: number, exitDate: string): TradeRow;
  dudKeep(id: number): TradeRow;
  getSettings(): { upeti: number; verifyDays: number };
  setSettings(input: { upeti?: number; verifyDays?: number }): void;
```
In `create`, remove `entryDate: input.entryDate,` from the inserted values and remove the `this.setLastUpeti(input.upeti);` line. (Add `fillPrice: null,` to the inserted defaults next to `fillDate: null,`.)
Update `fill`:
```ts
    fill(id, fillDate, fillPrice) {
      const t = require(id);
      if (t.status !== 'pending') throw new ConflictError('only pending orders can be filled');
      db.update(trades).set({ status: 'filled', fillDate, fillPrice, updatedAt: now() }).where(eq(trades.id, id)).run();
      return require(id);
    },
```
Replace `getLastUpeti`/`setLastUpeti` with:
```ts
    getSettings() {
      const rows = db.select().from(appSettings).all();
      const map = new Map(rows.map((r) => [r.key, r.value]));
      const upeti = map.has('upeti') ? Number(map.get('upeti')) : 100;
      const verifyDays = map.has('verify_days') ? Number(map.get('verify_days')) : 5;
      return { upeti, verifyDays };
    },
    setSettings(input) {
      const put = (key: string, value: string) =>
        db.insert(appSettings).values({ key, value })
          .onConflictDoUpdate({ target: appSettings.key, set: { value } }).run();
      if (input.upeti !== undefined) put('upeti', String(input.upeti));
      if (input.verifyDays !== undefined) put('verify_days', String(input.verifyDays));
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 5: Routes — settings endpoints + fill passes price (TDD)

**Files:**
- Modify: `src/server/routes.ts`
- Test: `src/server/routes.test.ts`

**Interfaces:**
- Consumes: `settingsSchema` (Task 3), `repo.getSettings/setSettings/fill` (Task 4).
- Produces:
  - `GET /api/settings` → `{ upeti, verifyDays }`.
  - `PATCH /api/settings` → validates body with `settingsSchema`, calls `setSettings`, returns `getSettings()`.
  - `POST /api/trades/:id/fill` → parses `{ fillDate, fillPrice }`, calls `repo.fill(id, fillDate, fillPrice)`.

- [ ] **Step 1: Update tests in `src/server/routes.test.ts`**

Remove `entryDate: '2026-08-03',` from the `body` fixture. Update the lifecycle fill request body to include a price: change `body: JSON.stringify({ fillDate: '2026-08-04' })` to `body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 52 })`. Add:
```ts
describe('settings endpoints', () => {
  it('GET returns defaults', async () => {
    const { app } = setup();
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upeti: 100, verifyDays: 5 });
  });
  it('PATCH updates and returns merged settings', async () => {
    const { app } = setup();
    const res = await app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ upeti: 250 }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upeti: 250, verifyDays: 5 });
  });
  it('PATCH rejects bad verifyDays with 400', async () => {
    const { app } = setup();
    const res = await app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verifyDays: 3 }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/routes.test.ts`
Expected: FAIL — settings routes missing / old `{ lastUpeti }` shape / fill arity.

- [ ] **Step 3: Edit `src/server/routes.ts`**

Add `settingsSchema` to the validation import. Update the fill route:
```ts
  api.post('/trades/:id/fill', async (c) => {
    const { fillDate, fillPrice } = fillSchema.parse(await c.req.json());
    return c.json(dto(repo.fill(Number(c.req.param('id')), fillDate, fillPrice)));
  });
```
Replace the settings route:
```ts
  api.get('/settings', (c) => c.json(repo.getSettings()));
  api.patch('/settings', async (c) => {
    const input = settingsSchema.parse(await c.req.json());
    repo.setSettings(input);
    return c.json(repo.getSettings());
  });
```

- [ ] **Step 4: Run to verify pass + full suite + typecheck**

Run: `eval "$(mise activate zsh)" && npx vitest run src/server/routes.test.ts`
Expected: PASS.
Run: `eval "$(mise activate zsh)" && npx vitest run`
Expected: full suite green.
Run: `eval "$(mise activate zsh)" && npx tsc --noEmit`
Expected: clean (server side; seed is fixed next task — if seed.ts errors here, proceed to Task 6 which fixes it, then re-run).

- [ ] **Step 5: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 6: Seed — drop entryDate, pass fillPrice, seed settings

**Files:**
- Modify: `src/server/seed.ts`

**Interfaces:**
- Consumes: `repo.fill(id, fillDate, fillPrice)`, `repo.setSettings`.
- Produces: seed compiles and runs under the new model.

- [ ] **Step 1: Edit `src/server/seed.ts`**

Remove `entryDate` from the `PlanSeed` type (`src/server/seed.ts:99`) and from the `mk`/`randomPlan` value objects (`:105`, `:111`, `:121`). Update each hand-written plan object in the fixed list (`:143-148`) to remove its `entryDate: ...` field. For the `randomPlan(entryDate, earningsDate, ...)` helper, drop the `entryDate` parameter and its callers' first arg (`:132-133`, `:136-137`, `:159-160`, `:187`).
Update every `repo.fill(t.id, <date>)` call to pass a fill price — use the plan's entry price: `repo.fill(t.id, <date>, plan.entryPrice)` (for `randomPlan` results, capture the plan and reuse its `entryPrice`). For the history-generating block (`:185-193`), pass the plan's `entryPrice` as fill price.
Optionally seed globals once near the start of seeding: `repo.setSettings({ upeti: 100, verifyDays: 5 });`

- [ ] **Step 2: Typecheck**

Run: `eval "$(mise activate zsh)" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-run the seed into a temp DB**

Run: `eval "$(mise activate zsh)" && DB_PATH=/tmp/tj-seed.db npx tsx src/server/seed.ts && rm -f /tmp/tj-seed.db*`
Expected: seeds without error. (Temp DB deleted after.)

- [ ] **Step 4: Full suite + stage**

Run: `eval "$(mise activate zsh)" && npx vitest run`
Expected: green.
Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 7: Client — settings API + header controls

**Files:**
- Modify: `src/client/api.ts`
- Create: `src/client/components/SettingsControls.tsx`
- Modify: `src/client/App.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/settings`.
- Produces:
  - `api.settings(): Promise<{ upeti: number; verifyDays: number }>`
  - `api.updateSettings(body: { upeti?: number; verifyDays?: number }): Promise<{ upeti: number; verifyDays: number }>`
  - `api.fill(id, fillDate, fillPrice)` — updated signature (used in Task 9).
  - `<SettingsControls />` — header widget editing both globals.

- [ ] **Step 1: Update `src/client/api.ts`**

Change `settings` and add `updateSettings`; update `fill`:
```ts
  settings: () => fetch('/api/settings').then(json<{ upeti: number; verifyDays: number }>),
  updateSettings: (b: { upeti?: number; verifyDays?: number }) =>
    fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(json<{ upeti: number; verifyDays: number }>),
```
```ts
  fill: (id: number, fillDate: string, fillPrice: number) => post(`/api/trades/${id}/fill`, { fillDate, fillPrice }).then(json<TradeDTO>),
```

- [ ] **Step 2: Create `src/client/components/SettingsControls.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from './Toast';

const VERIFY = [5, 7, 10, 14];

export function SettingsControls() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [upeti, setUpeti] = useState('');
  useEffect(() => { if (settings.data) setUpeti(String(settings.data.upeti)); }, [settings.data]);

  const save = useMutation({
    mutationFn: (b: { upeti?: number; verifyDays?: number }) => api.updateSettings(b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (err: Error) => toast(err.message ?? 'Could not save settings', 'error'),
  });

  const input = 'w-24 rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1 text-sm';
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
      <label className="flex items-center gap-1">UPETI $
        <input type="number" step="any" value={upeti} onChange={(e) => setUpeti(e.target.value)}
          onBlur={() => { const v = Number(upeti); if (v > 0 && v !== settings.data?.upeti) save.mutate({ upeti: v }); }}
          className={input} />
      </label>
      <label className="flex items-center gap-1">Confirm in
        <select value={settings.data?.verifyDays ?? 5} onChange={(e) => save.mutate({ verifyDays: Number(e.target.value) })}
          className={input}>
          {VERIFY.map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Mount it in the header (`src/client/App.tsx`)**

Import it and add it to the header's right-side control group, before the New Trade button:
```tsx
          <div className="flex items-center gap-3">
            <SettingsControls />
            <button onClick={() => setFormOpen(true)} className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">+ New Trade Plan</button>
            <ThemeToggle />
          </div>
```
Add `import { SettingsControls } from './components/SettingsControls';` at the top.

- [ ] **Step 4: Typecheck + build**

Run: `eval "$(mise activate zsh)" && npx tsc --noEmit` — clean.
Run: `eval "$(mise activate zsh)" && npm run build` — succeeds.

- [ ] **Step 5: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 8: Client — 3-column create form (drop entryDate/UPETI/Confirm-in)

**Files:**
- Modify: `src/client/components/TradeForm.tsx`

**Interfaces:**
- Consumes: `api.settings()` (upeti + verifyDays), `api.create`.
- Produces: create payload includes `upeti` + `verifyDays` (copied from settings), no `entryDate`.

- [ ] **Step 1: Edit `src/client/components/TradeForm.tsx` — state + payload**

Remove the entry-date state/validation and the verifyDays/upeti-input state:
- Remove `const [entryDate, setEntryDate] = useState(todayISO());`
- Remove `const [verifyDays, setVerifyDays] = useState(5);`
- Remove the `entryDateError` line.
- Change the settings prefill effect to read the new shape and drive both snapshots. Replace:
  ```tsx
  useEffect(() => { if (settings.data) setUpeti(String(settings.data.lastUpeti ?? 100)); }, [settings.data]);
  ```
  with:
  ```tsx
  useEffect(() => { if (settings.data) setUpeti(String(settings.data.upeti)); }, [settings.data]);
  ```
- In the `create` mutation body, remove `entryDate,` and change `verifyDays` to come from settings:
  ```tsx
  mutationFn: () => api.create({
    ticker, upeti: Number(upeti), entryPrice: Number(entryPrice), slPrice: Number(slPrice),
    tpPrice: tpPrice ? Number(tpPrice) : null, entryType, entrySignal,
    earningsDate, notes: notes.trim() || null, verifyDays: settings.data?.verifyDays ?? 5,
  }),
  ```
- Update `valid` to drop `!entryDateError`:
  ```tsx
  const valid = ticker && u > 0 && e > s && s > 0 && earningsDate && !slError && !tpError && !earningsDateError;
  ```

- [ ] **Step 2: Edit the JSX — 3-column grid, new field order**

Change the grid container to `grid-cols-3`:
```tsx
      <div className="grid grid-cols-3 gap-3 text-sm">
```
Reorder to: Ticker, Earnings Date, spacer / Entry Signal, Entry Type, spacer / Entry Price, SL Price, TP Price / Notes (col-span-3). Remove the Entry-date label and the Verify-in label entirely. Concretely, the field rows become (keep each input's existing classes/handlers; only the earnings input keeps its status hints and rollForward90 onChange):
```tsx
        {/* Row 1 */}
        <label>Ticker<input value={ticker} onChange={(e) => setTicker(e.target.value)} onBlur={lookupEarnings} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
        <label>Earnings date<input type="date" min={today} value={earningsDate} onChange={(ev) => { setEarningsEdited(true); setEarningsStatus('idle'); setEarningsDate(rollForward90(ev.target.value)); }} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${earningsDateError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{earningsDateError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{earningsDateError}</span>}{!earningsDateError && earningsStatus === 'loading' && <span className="mt-1 block text-xs text-slate-400">Looking up earnings…</span>}{!earningsDateError && earningsStatus === 'fetched' && <span className="mt-1 block text-xs text-slate-400">Fetched from Finnhub</span>}{!earningsDateError && earningsStatus === 'notfound' && <span className="mt-1 block text-xs text-slate-400">No earnings date found — enter manually</span>}</label>
        <div />
        {/* Row 2 */}
        <label>Entry signal<select value={entrySignal} onChange={(e) => setEntrySignal(e.target.value as EntrySignal)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1">{SIGNALS.map((s) => <option key={s} value={s}>{SIGNAL_LABELS[s]}</option>)}</select></label>
        <label>Entry type<select value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1"><option value="buy_limit">Buy Limit</option><option value="buy_stop">Buy Stop</option></select></label>
        <div />
        {/* Row 3 */}
        <label>Entry price<input type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
        <label>SL price<input type="number" step="any" value={slPrice} onChange={(ev) => { setSlEdited(true); setSlPrice(ev.target.value); }} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${slError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{slError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{slError}</span>}</label>
        <label>TP price (optional)<input type="number" step="any" value={tpPrice} onChange={(ev) => { setTpEdited(true); setTpPrice(ev.target.value); }} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${tpError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{tpError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{tpError}</span>}</label>
        {/* Notes */}
        <label className="col-span-3">Notes (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Thesis, setup, risks…" className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
```

- [ ] **Step 3: Typecheck + build**

Run: `eval "$(mise activate zsh)" && npx tsc --noEmit` — clean.
Run: `eval "$(mise activate zsh)" && npm run build` — succeeds.

- [ ] **Step 4: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 9: Client — Mark-filled modal (date + price)

**Files:**
- Create: `src/client/components/FillModal.tsx`
- Modify: `src/client/components/PlanTables.tsx`

**Interfaces:**
- Consumes: `api.fill(id, fillDate, fillPrice)`, `Modal` from `./ExitForm`.
- Produces: `<FillModal trade={TradeDTO} onClose={() => void} />` that fills on confirm.

- [ ] **Step 1: Create `src/client/components/FillModal.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { TradeDTO } from '../../lib/types';
import { Modal } from './ExitForm';
import { useToast } from './Toast';

const todayISO = () => new Date().toISOString().slice(0, 10);

export function FillModal({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fillDate, setFillDate] = useState(todayISO());
  const [fillPrice, setFillPrice] = useState(String(trade.entryPrice));

  const m = useMutation({
    mutationFn: () => api.fill(trade.id, fillDate, Number(fillPrice)),
    onSuccess: () => { qc.invalidateQueries(); toast('Order marked as filled'); onClose(); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  const price = Number(fillPrice);
  const valid = fillDate !== '' && price > 0;
  const input = 'mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1';
  return (
    <Modal title={`Mark ${trade.ticker} filled`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Fill date<input type="date" value={fillDate} onChange={(e) => setFillDate(e.target.value)} className={input} /></label>
        <label>Fill price<input type="number" step="any" value={fillPrice} onChange={(e) => setFillPrice(e.target.value)} className={input} /></label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="cursor-pointer px-3 py-1 rounded bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100">Cancel</button>
        <button disabled={!valid || m.isPending} onClick={() => m.mutate()} className="cursor-pointer px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed">Confirm fill</button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire it into `src/client/components/PlanTables.tsx`**

In `PendingOrders`, add state and replace the one-click fill:
- Add near the other `useState`: `const [filling, setFilling] = useState<TradeDTO | null>(null);`
- Import: `import { FillModal } from './FillModal';`
- Remove the `fill` mutation (the `useMutation` block calling `api.fill(id, todayISO())`).
- Change the Mark-filled button to open the modal:
  ```tsx
  <button onClick={() => setFilling(t)} className="cursor-pointer rounded bg-emerald-600 px-2 py-0.5 text-xs text-white">Mark filled</button>
  ```
- Before the closing `</section>`, render the modal:
  ```tsx
  {filling && <FillModal trade={filling} onClose={() => setFilling(null)} />}
  ```
- If `todayISO` is now unused in this file, remove its import/const to keep tsc clean.

- [ ] **Step 3: Typecheck + build**

Run: `eval "$(mise activate zsh)" && npx tsc --noEmit` — clean.
Run: `eval "$(mise activate zsh)" && npm run build` — succeeds.

- [ ] **Step 4: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 10: Client — tables/details show fill date + price

**Files:**
- Modify: `src/client/components/PlanTables.tsx`, `src/client/components/HistoryTable.tsx`, `src/client/components/TradeDetails.tsx`

**Interfaces:**
- Consumes: `TradeDTO.fillDate`, `TradeDTO.fillPrice`.
- Produces: no `entryDate` references remain anywhere in the client.

- [ ] **Step 1: `PlanTables.tsx` — entry cell**

Replace the entry sub-line (`<div ...>{t.entryDate}</div>`) with fill info that degrades while pending:
```tsx
      <td className="px-3 py-2">
        <div>{money(t.entryPrice)}</div>
        <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">
          {t.fillDate ? `filled @ ${money(t.fillPrice)} · ${t.fillDate}` : '—'}
        </div>
      </td>
```

- [ ] **Step 2: `HistoryTable.tsx` — entry cell**

Replace `<div ...>{t.entryDate}</div>` with:
```tsx
                <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                  {t.fillDate ? `filled @ ${money(t.fillPrice)} · ${t.fillDate}` : '—'}
                </div>
```

- [ ] **Step 3: `TradeDetails.tsx` — entry/fill rows**

Replace the `['Entry', ...(trade.entryDate)]` row with a plain entry-price row, and add a fill row when filled/exited:
```tsx
    ['Entry', money(trade.entryPrice)],
    ['SL / TP', `${money(trade.slPrice)} / ${money(trade.tpPrice)}`],
    ['Shares', String(trade.shares)],
    ['Earnings', trade.earningsDate ?? '—'],
```
Then, right after the `rows` array is declared, insert:
```tsx
  if (trade.fillDate) {
    rows.splice(4, 0, ['Fill', `${money(trade.fillPrice)}  (${trade.fillDate})`]);
  }
```
(Index 4 places "Fill" after "Entry type"; adjust if the array order differs — the requirement is simply that a Fill row appears for filled/exited trades.)

- [ ] **Step 4: Confirm no entryDate references remain**

Run: `eval "$(mise activate zsh)" && grep -rn "entryDate" src/ || echo "none"`
Expected: `none`.

- [ ] **Step 5: Typecheck + build + full suite**

Run: `eval "$(mise activate zsh)" && npx tsc --noEmit` — clean.
Run: `eval "$(mise activate zsh)" && npm run build` — succeeds.
Run: `eval "$(mise activate zsh)" && npx vitest run` — green.

- [ ] **Step 6: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

### Task 11: Docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README.md — update Concepts**

Update the UPETI and Earnings/entry bullets to reflect globals + fill capture. Replace the UPETI concept line and add a settings note:
```markdown
- **UPETI** (risk $) and **Confirm-in** (verify days) are global settings, edited in the
  header and snapshotted onto each new trade. Shares = floor(UPETI / (entry − SL)).
- **Mark filled** captures the actual fill date and fill price; realized P&L uses the
  fill price as cost basis: (exit − fill) × shares.
```

- [ ] **Step 2: CLAUDE.md — update Key domain rules**

Adjust the domain-rules bullets:
```markdown
- **UPETI** = risk amount in dollars; a global setting (in `app_settings`) snapshotted per trade at creation. Changing it never rewrites existing trades.
- **shares** = `floor(upeti / (entry − sl))`, sized at creation from the planned entry price.
- **realizedPnl** = `(exit − fillPrice) × shares` (gross); `fillPrice` is captured at Mark-filled and falls back to `entryPrice` if absent.
- **Confirm-in / verifyDays** is a global setting snapshotted per trade; the dud-check runs off `fill_date`.
- There is a single trade date: `fill_date` (set at Mark-filled). There is no separate entry date.
```
Remove/replace any now-stale line stating earnings is entered manually with no external API (already handled by the earnings feature) — leave that as-is; only update entry-date/UPETI rules.

- [ ] **Step 3: Stage**

Run: `eval "$(mise activate zsh)" && git add -A`

---

## Self-Review

**Spec coverage:**
- §1 Data model: drop entry_date, add fill_price, migration → Task 1; types + cost-basis calc → Task 2 ✓
- §2 Globals: app_settings upeti/verify_days, getSettings/setSettings, GET/PATCH /settings, header controls → Tasks 4,5,7 ✓
- §3 3-col create form, field order, no entryDate/UPETI/Confirm-in → Task 8 ✓
- §4 Mark-filled modal (date + required price, defaults to entry) → Task 9; fill signature → Tasks 4,5,7 ✓
- Ripples: tables/details fillDate+price → Task 10; seed → Task 6; tests → Tasks 2–6; docs → Task 11 ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. The only judgement call (fill-row index in TradeDetails) is explicitly bounded by its requirement.

**Type consistency:**
- `fill(id, fillDate, fillPrice)` — identical across repo interface (Task 4), routes (Task 5), api (Task 7), FillModal (Task 9).
- `getSettings(): { upeti, verifyDays }` / `setSettings({ upeti?, verifyDays? })` — consistent across repo (Task 4), routes (Task 5), api shapes (Task 7).
- `TradeRow.fillPrice: number | null`, `entryDate` removed — consistent across schema (Task 1), types (Task 2), all consumers (Tasks 6,8,9,10).
- `costBasis = fillPrice ?? entryPrice` — defined once in `deriveTrade` (Task 2), relied on by table/detail display (Task 10).
