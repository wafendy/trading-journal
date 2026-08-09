/**
 * Seed script — populates the DB with HEAVY, representative data that
 * demonstrates every UI condition and simulates real usage volume.
 *
 * Volume: up to 10 pending, up to 25 active positions, 100+ exited trades
 * across several years (so Trading History infinite-scroll and the year
 * selector are meaningfully exercised).
 *
 * Commands:
 *   npm run seed              seed ./trading.db (refuses if it already has trades)
 *   npm run seed -- --force   wipe existing data, then reseed
 *   npm run seed:reset        wipe all trades + settings, do NOT reseed
 *   (npm run seed -- --reset  is equivalent to seed:reset)
 *
 * Dud flags and earnings-proximity warnings are computed at READ time from the
 * REAL current date, so time-sensitive rows are dated RELATIVE to today — the
 * seed demonstrates those states no matter when it is run.
 */
import { sql, eq } from 'drizzle-orm';
import { createDb, migrateDb } from './db/index';
import { createRepo } from './repository';
import { trades } from './db/schema';
import type { EntrySignal, EntryType, VerifyDays } from '../lib/types';

const args = process.argv.slice(2);
const force = args.includes('--force');
const resetOnly = args.includes('--reset');
const dbPath = process.env.DB_PATH ?? './trading.db';

const { db, sqlite } = createDb(dbPath);
migrateDb(db);

function wipe() {
  db.run(sql`delete from trades`);
  db.run(sql`delete from app_settings`);
  db.run(sql`delete from sqlite_sequence where name = 'trades'`);
}

if (resetOnly) {
  const before = db.get<{ n: number }>(sql`select count(*) as n from trades`);
  wipe();
  sqlite.close();
  console.log(`Reset complete for ${dbPath} — removed ${before?.n ?? 0} trades and cleared settings.`);
  process.exit(0);
}

const existing = db.get<{ n: number }>(sql`select count(*) as n from trades`);
if (existing && existing.n > 0 && !force) {
  console.error(
    `Refusing to seed: ${existing.n} trades already exist in ${dbPath}.\n` +
      `  Reseed:  npm run seed -- --force\n` +
      `  Reset :  npm run seed:reset`,
  );
  process.exit(1);
}
if (force) wipe();

const repo = createRepo(db, () => new Date().toISOString());

// ── Deterministic PRNG (seeded) so runs are reproducible ────────────────────
let _s = 0x2f6e2b1;
const rnd = () => {
  _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; _s >>>= 0;
  return _s / 0xffffffff;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Date helpers (relative to REAL today) ───────────────────────────────────
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const todayISO = iso(today);
const daysFromNow = (n: number) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const addDaysISO = (base: string, n: number) => { const d = new Date(base + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const thisYear = today.getUTCFullYear();

const SIGNALS: readonly EntrySignal[] = ['btb', 'buy_lautan', 'buy_magenta', 'hawk1', 'buy_spec'];
const TYPES: readonly EntryType[] = ['buy_limit', 'buy_stop'];
const VERIFY: readonly VerifyDays[] = [5, 7, 10, 14];
const TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'GOOGL', 'AMZN', 'NFLX', 'AVGO',
  'CRWD', 'SHOP', 'UBER', 'SOFI', 'PLTR', 'COIN', 'MSTR', 'SMCI', 'RIVN', 'ARM',
  'SNOW', 'DDOG', 'NET', 'PANW', 'ORCL', 'ADBE', 'QCOM', 'MU', 'INTC', 'BABA',
];
const NOTES_POOL = [
  'Breakout above resistance on strong volume.',
  'Buying the pullback to the 20-day MA.',
  'Earnings run-up play; plan to exit before report.',
  'Sector momentum + relative strength leader.',
  'Cup-and-handle base, tight pivot.',
  'Speculative starter position, small size.',
  'Reclaimed prior support; risk defined at swing low.',
  'Trend continuation after consolidation.',
];

interface PlanSeed {
  ticker: string; upeti: number; entryPrice: number; slPrice: number; tpPrice?: number | null;
  entryType: EntryType; entrySignal: EntrySignal; entryDate: string; earningsDate: string;
  notes?: string | null; verifyDays: VerifyDays;
}
const mk = (p: PlanSeed) =>
  repo.create({
    ticker: p.ticker, upeti: p.upeti, entryPrice: p.entryPrice, slPrice: p.slPrice, tpPrice: p.tpPrice ?? null,
    entryType: p.entryType, entrySignal: p.entrySignal, entryDate: p.entryDate, earningsDate: p.earningsDate,
    notes: p.notes ?? null, verifyDays: p.verifyDays,
  });
const clearEarnings = (id: number) => db.update(trades).set({ earningsDate: null }).where(eq(trades.id, id)).run();

// A randomized plan around a base price. entryDate/earningsDate supplied by caller.
function randomPlan(entryDate: string, earningsDate: string, withNote: boolean): PlanSeed {
  const entry = round2(between(15, 600));
  return {
    ticker: pick(TICKERS),
    upeti: pick([100, 100, 100, 250, 500, 750, 1000]),
    entryPrice: entry,
    slPrice: round2(entry * between(0.9, 0.97)),
    tpPrice: rnd() < 0.8 ? round2(entry * between(1.05, 1.25)) : null,
    entryType: pick(TYPES),
    entrySignal: pick(SIGNALS),
    entryDate,
    earningsDate,
    notes: withNote ? pick(NOTES_POOL) : null,
    verifyDays: pick(VERIFY),
  };
}

// ── Pending orders (≤10) — guarantee every entry signal appears ──────────────
// First 5 cover each signal (btb, buy_lautan, buy_magenta, hawk1, buy_spec),
// then 5 more are random, for 10 total.
SIGNALS.forEach((signal, i) => {
  const entryDate = daysFromNow(i % 6);
  mk({ ...randomPlan(entryDate, daysFromNow(60 + i * 3), rnd() < 0.5), entrySignal: signal });
});
for (let i = 0; i < 5; i++) {
  const entryDate = daysFromNow(i % 6);
  mk(randomPlan(entryDate, daysFromNow(75 + i * 3), rnd() < 0.5));
}

// ── Active positions (≤25) ───────────────────────────────────────────────────
// First, the six labelled demo conditions (stable tickers), then fill to ~22.
const demoActive: { plan: PlanSeed; fill: string; keep?: boolean; nullEarn?: boolean }[] = [
  { plan: { ticker: 'TSLA', upeti: 1000, entryPrice: 330, slPrice: 300, tpPrice: 400, entryType: 'buy_limit', entrySignal: 'buy_magenta', entryDate: daysFromNow(-30), earningsDate: daysFromNow(60), notes: 'Held past verify window — decide keep/exit.', verifyDays: 5 }, fill: daysFromNow(-25) }, // dud-flagged
  { plan: { ticker: 'NVDA', upeti: 1200, entryPrice: 178, slPrice: 168, tpPrice: 210, entryType: 'buy_stop', entrySignal: 'hawk1', entryDate: todayISO, earningsDate: daysFromNow(70), notes: 'Fresh add on strength.', verifyDays: 7 }, fill: todayISO }, // fresh
  { plan: { ticker: 'MSFT', upeti: 800, entryPrice: 505, slPrice: 480, entryType: 'buy_limit', entrySignal: 'btb', entryDate: daysFromNow(-40), earningsDate: daysFromNow(65), verifyDays: 5 }, fill: daysFromNow(-38), keep: true }, // kept
  { plan: { ticker: 'GOOGL', upeti: 650, entryPrice: 165, slPrice: 156.75, tpPrice: 181.5, entryType: 'buy_limit', entrySignal: 'buy_lautan', entryDate: daysFromNow(-1), earningsDate: daysFromNow(3), notes: 'Earnings in a few days — watch closely.', verifyDays: 10 }, fill: todayISO }, // earnings 3d
  { plan: { ticker: 'AMZN', upeti: 700, entryPrice: 205, slPrice: 194.75, tpPrice: 225.5, entryType: 'buy_stop', entrySignal: 'btb', entryDate: daysFromNow(-1), earningsDate: todayISO, verifyDays: 7 }, fill: todayISO }, // earnings today
  { plan: { ticker: 'COIN', upeti: 500, entryPrice: 250, slPrice: 237.5, tpPrice: 275, entryType: 'buy_limit', entrySignal: 'buy_spec', entryDate: daysFromNow(-1), earningsDate: daysFromNow(50), verifyDays: 7 }, fill: todayISO, nullEarn: true }, // missing earnings
];
for (const a of demoActive) {
  const t = mk(a.plan);
  repo.fill(t.id, a.fill);
  if (a.keep) repo.dudKeep(t.id);
  if (a.nullEarn) clearEarnings(t.id);
}
// Extra active positions (filled recently so not dud-flagged), up to ~22 total.
const EXTRA_ACTIVE = 16;
for (let i = 0; i < EXTRA_ACTIVE; i++) {
  const entryDate = daysFromNow(-(1 + Math.floor(rnd() * 3)));
  const t = mk(randomPlan(entryDate, daysFromNow(20 + Math.floor(rnd() * 80)), rnd() < 0.5));
  repo.fill(t.id, entryDate);
}

// ── Exited trades → Trading History (100+ total) ─────────────────────────────
// Per-year targets are chosen so BOTH the current year and last year exceed 50,
// which is what actually exercises the History tab's per-year infinite scroll
// (a single year must have >50 rows to load a second page). Earlier years add
// depth for the year selector without needing to paginate.
const perYear: Record<number, number> = {
  [thisYear]: 60,
  [thisYear - 1]: 60,
  [thisYear - 2]: 24,
  [thisYear - 3]: 18,
};
let created = 0;
for (const [yStr, target] of Object.entries(perYear)) {
  const year = Number(yStr);
  let made = 0, attempts = 0;
  while (made < target && attempts < target * 4) {
    attempts++;
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 27);
    const exitDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (exitDate > todayISO) continue; // history is realized/past only
    const entryDate = addDaysISO(exitDate, -(10 + Math.floor(rnd() * 90)));
    const fillDate = addDaysISO(entryDate, 1);
    const plan = randomPlan(entryDate, addDaysISO(entryDate, 30), rnd() < 0.5);
    const win = rnd() < 0.58; // ~58% win rate
    const exitPrice = win
      ? round2(plan.entryPrice * between(1.03, 1.3))
      : round2(plan.entryPrice * between(0.82, 0.99));
    const t = mk(plan);
    repo.fill(t.id, fillDate);
    repo.exit(t.id, exitPrice, exitDate);
    made++; created++;
  }
}
void created;

const counts = db.get<{ pending: number; filled: number; exited: number }>(sql`
  select
    sum(case when status = 'pending' then 1 else 0 end) as pending,
    sum(case when status = 'filled'  then 1 else 0 end) as filled,
    sum(case when status = 'exited'  then 1 else 0 end) as exited
  from trades
`);
const years = db.all<{ y: string }>(sql`select distinct substr(exit_date,1,4) as y from trades where status='exited' order by y desc`);

sqlite.close();
console.log('Seed complete for', dbPath);
console.log(`  pending: ${counts?.pending ?? 0} (max 10)   active: ${counts?.filled ?? 0} (max 25)   history: ${counts?.exited ?? 0}`);
console.log(`  history years: ${years.map((r) => r.y).join(', ')}`);
console.log('  Active Positions demonstrate: TSLA=Verify(dud), NVDA=fresh, MSFT=kept, GOOGL=earnings 3d, AMZN=earnings today, COIN=no earnings date.');
console.log('  Many trades carry notes ("note" tag in the tables; click a row to read).');
console.log('  Wipe: npm run seed:reset   |   Reseed: npm run seed -- --force');
