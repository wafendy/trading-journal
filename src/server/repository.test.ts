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

const base = { ticker: 'aapl', upeti: 1000, entryPrice: 50, slPrice: 45, entryType: 'buy_limit' as const, entrySignal: 'btb' as const, direction: 'long' as const, earningsDate: '2026-08-25', verifyDays: 5 as const };

describe('create + lifecycle', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('creates pending', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    expect(t.status).toBe('pending');
  });

  it('persists notes on create and defaults to null', () => {
    const withNotes = ctx.repo.create({ ...base, ticker: 'AAPL', notes: 'breakout thesis' });
    expect(ctx.repo.getById(withNotes.id)!.notes).toBe('breakout thesis');
    const without = ctx.repo.create({ ...base, ticker: 'MSFT' });
    expect(ctx.repo.getById(without.id)!.notes).toBeNull();
  });

  it('can update notes via patch', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    ctx.repo.patch(t.id, { notes: 'updated rationale' });
    expect(ctx.repo.getById(t.id)!.notes).toBe('updated rationale');
  });

  it('fill then exit moves to history', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    ctx.repo.fill(t.id, '2026-08-04', 50, null);
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
    ctx.repo.fill(t.id, '2026-08-04', 50, null);
    expect(() => ctx.repo.cancel(t.id)).toThrow(ConflictError);
  });

  it('cannot exit a pending order', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    expect(() => ctx.repo.exit(t.id, 55, '2026-08-20')).toThrow(ConflictError);
  });

  it('patch throws NotFound for missing id', () => {
    expect(() => ctx.repo.patch(999, { upeti: 5 })).toThrow(NotFoundError);
  });

  it('persists earningsDate on create and returns it via getById', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    expect(t.earningsDate).toBe('2026-08-25');
    expect(ctx.repo.getById(t.id)!.earningsDate).toBe('2026-08-25');
  });

  it('patch can update earningsDate', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    const updated = ctx.repo.patch(t.id, { earningsDate: '2026-09-15' });
    expect(updated.earningsDate).toBe('2026-09-15');
    expect(ctx.repo.getById(t.id)!.earningsDate).toBe('2026-09-15');
  });
});

describe('fill captures price', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });
  it('persists fillDate and fillPrice', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    const f = ctx.repo.fill(t.id, '2026-08-04', 52, null);
    expect(f.status).toBe('filled');
    expect(f.fillDate).toBe('2026-08-04');
    expect(f.fillPrice).toBe(52);
    expect(f.fillShares).toBeNull();
  });
  it('persists a manual fill quantity', () => {
    const t = ctx.repo.create({ ...base, ticker: 'AAPL' });
    const f = ctx.repo.fill(t.id, '2026-08-04', 52, 18);
    expect(f.fillShares).toBe(18);
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

describe('history + years', () => {
  const mkExited = (repo: ReturnType<typeof createRepo>, exitDate: string) => {
    const t = repo.create({ ...base, ticker: 'AAPL' });
    repo.fill(t.id, '2025-01-02', 50, null);
    repo.exit(t.id, 55, exitDate);
    return t.id;
  };

  it('filters by exit year, newest first, paginates (monotonic ids)', () => {
    const { repo } = setup();
    mkExited(repo, '2025-03-01'); mkExited(repo, '2025-04-01'); mkExited(repo, '2025-05-01');
    const t2024 = repo.create({ ...base }); repo.fill(t2024.id, '2024-01-02', 50, null); repo.exit(t2024.id, 55, '2024-06-01');

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
