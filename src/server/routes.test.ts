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
