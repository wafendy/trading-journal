import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrateDb } from './db/index';
import { createRepo } from './repository';
import { buildApp } from './app';

function setup() {
  const { db } = createDb(':memory:');
  migrateDb(db);
  let clock = '2026-08-10T00:00:00Z';
  let earnings: string | null = null;
  let quote: number | null = null;
  const repo = createRepo(db, () => clock);
  const app = buildApp({ repo, now: () => clock, getNextEarnings: async () => earnings, getQuote: async () => quote });
  return { app, repo, setClock: (c: string) => (clock = c), setEarnings: (d: string | null) => (earnings = d), setQuote: (p: number | null) => (quote = p) };
}

const body = { ticker: 'aapl', upeti: 1000, entryPrice: 50, slPrice: 45, entryType: 'buy_limit', entrySignal: 'btb', earningsDate: '2026-08-25', verifyDays: 5 };

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
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
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

  it('DELETE removes an exited trade from history', async () => {
    const { app } = setup();
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
    await app.request(`/api/trades/${created.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });

    const del = await app.request(`/api/trades/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    const hist = await (await app.request('/api/trades/history?year=2026&limit=50')).json();
    expect(hist.items).toHaveLength(0);
  });

  it('DELETE on a pending trade returns 409', async () => {
    const { app } = setup();
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const res = await app.request(`/api/trades/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/quote', () => {
  it('returns the provider price', async () => {
    const { app, setQuote } = setup();
    setQuote(123.45);
    const res = await app.request('/api/quote?ticker=aapl');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ price: 123.45 });
  });
  it('returns null price when the provider has none', async () => {
    const { app } = setup(); // quote defaults to null
    expect(await (await app.request('/api/quote?ticker=AAPL')).json()).toEqual({ price: null });
  });
  it('rejects an invalid ticker', async () => {
    const { app } = setup();
    expect((await app.request('/api/quote?ticker=')).status).toBe(400);
  });
});

describe('GET /api/trades?status=filled includes dud flag', () => {
  it('flags after verify window', async () => {
    const { app } = setup(); // clock 2026-08-10
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-03', fillPrice: 50 }) });
    const filled = await (await app.request('/api/trades?status=filled')).json();
    // 2026-08-03 Mon -> 2026-08-10 Mon = 5 weekdays >= 5
    expect(filled[0].dudFlagged).toBe(true);
  });
});

describe('GET /api/earnings', () => {
  it('returns the provider result', async () => {
    const { app, setEarnings } = setup();
    setEarnings('2026-11-19');
    const res = await app.request('/api/earnings?ticker=nvda');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ earningsDate: '2026-11-19' });
  });
  it('returns null earningsDate when provider yields null', async () => {
    const { app } = setup();
    expect(await (await app.request('/api/earnings?ticker=AAPL')).json()).toEqual({ earningsDate: null });
  });
  it('400 on missing or invalid ticker', async () => {
    const { app } = setup();
    expect((await app.request('/api/earnings')).status).toBe(400);
    expect((await app.request('/api/earnings?ticker=BAD!')).status).toBe(400);
  });
});

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

describe('GET /api/summary bySignal', () => {
  const mk = async (app: ReturnType<typeof setup>['app'], entrySignal: string) =>
    (await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, entrySignal }) })).json());

  it('breaks down per signal, honoring fillPrice cost basis', async () => {
    const { app } = setup();
    // btb: entry 50, sl 45 -> shares 200; fill @ 52, exit 55 => (55-52)*200 = 600 (win)
    const a = await mk(app, 'btb');
    await app.request(`/api/trades/${a.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 52 }) });
    await app.request(`/api/trades/${a.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });
    // buy_lautan: fill @ 50, exit 45 => (45-50)*200 = -1000 (loss)
    const b = await mk(app, 'buy_lautan');
    await app.request(`/api/trades/${b.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
    await app.request(`/api/trades/${b.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 45, exitDate: '2026-08-21' }) });

    const s = await (await app.request('/api/summary?year=2026')).json();
    expect(s.totalPnl).toBe(-400);
    expect(s.tradeCount).toBe(2);
    expect(s.winRate).toBe(0.5);
    // sorted by pnl desc: btb (600) before buy_lautan (-1000)
    expect(s.bySignal.map((g: { signal: string }) => g.signal)).toEqual(['btb', 'buy_lautan']);
    const btb = s.bySignal.find((g: { signal: string }) => g.signal === 'btb');
    expect(btb).toMatchObject({ pnl: 600, tradeCount: 1, winRate: 1 });
    const lautan = s.bySignal.find((g: { signal: string }) => g.signal === 'buy_lautan');
    expect(lautan).toMatchObject({ pnl: -1000, tradeCount: 1, winRate: 0 });
  });

  it('omits signals with no trades', async () => {
    const { app } = setup();
    const a = await mk(app, 'btb');
    await app.request(`/api/trades/${a.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
    await app.request(`/api/trades/${a.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });
    const s = await (await app.request('/api/summary?year=2026')).json();
    expect(s.bySignal).toHaveLength(1);
    expect(s.bySignal[0].signal).toBe('btb');
  });
});
