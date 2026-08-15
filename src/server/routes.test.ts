// @vitest-environment node
// Server routes handle real multipart binary uploads; jsdom's Blob corrupts binary
// bytes (UTF-8 coercion), so run this suite in the Node environment like production.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createDb, migrateDb } from './db/index';
import { createRepo } from './repository';
import { buildApp } from './app';
import { createScreenshotStore } from './screenshots';
import { ConflictError } from './repository';
import type { T1moCapturer, CaptureResult } from './t1moCapture';

function setup(t1moCapturer: T1moCapturer | null = null) {
  const { db } = createDb(':memory:');
  migrateDb(db);
  let clock = '2026-08-10T00:00:00Z';
  let earnings: string | null = null;
  let quote: number | null = null;
  const repo = createRepo(db, () => clock);
  const shotsDir = mkdtempSync(join(tmpdir(), 'routes-shots-'));
  const screenshots = createScreenshotStore(shotsDir);
  const app = buildApp({ repo, now: () => clock, getNextEarnings: async () => earnings, getQuote: async () => quote, getProfile: async () => null, screenshots, t1moCapturer });
  return { app, repo, shotsDir, setClock: (c: string) => (clock = c), setEarnings: (d: string | null) => (earnings = d), setQuote: (p: number | null) => (quote = p) };
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

  it('history filters by ?signal=', async () => {
    const { app } = setup();
    const mkExit = async (entrySignal: string) => {
      const t = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, entrySignal }) })).json();
      await app.request(`/api/trades/${t.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
      await app.request(`/api/trades/${t.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });
    };
    await mkExit('btb');
    await mkExit('hawk1');

    const all = await (await app.request('/api/trades/history?year=2026&limit=50')).json();
    expect(all.items).toHaveLength(2);
    const btb = await (await app.request('/api/trades/history?year=2026&limit=50&signal=btb')).json();
    expect(btb.items).toHaveLength(1);
    expect(btb.items[0].entrySignal).toBe('btb');
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
    expect(await res.json()).toEqual({ upeti: 100, verifyDays: 15 });
  });
  it('PATCH updates and returns merged settings', async () => {
    const { app } = setup();
    const res = await app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ upeti: 250 }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upeti: 250, verifyDays: 15 });
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

  it('honors the ?from=/?to= month range', async () => {
    const { app } = setup();
    // June exit: (55-50)*200 = 1000 win; October exit: (45-50)*200 = -1000 loss
    const jun = await mk(app, 'btb');
    await app.request(`/api/trades/${jun.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-06-01', fillPrice: 50 }) });
    await app.request(`/api/trades/${jun.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-06-20' }) });
    const oct = await mk(app, 'btb');
    await app.request(`/api/trades/${oct.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-10-01', fillPrice: 50 }) });
    await app.request(`/api/trades/${oct.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 45, exitDate: '2026-10-20' }) });

    const all = await (await app.request('/api/summary?year=2026')).json();
    expect(all.tradeCount).toBe(2);
    // from July onward: only the October trade counts.
    const since = await (await app.request('/api/summary?year=2026&from=7&to=12')).json();
    expect(since.tradeCount).toBe(1);
    expect(since.totalPnl).toBe(-1000);
    // Jan–June: only the June trade counts.
    const firstHalf = await (await app.request('/api/summary?year=2026&from=1&to=6')).json();
    expect(firstHalf.tradeCount).toBe(1);
    expect(firstHalf.totalPnl).toBe(1000);
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

describe('screenshot routes', () => {
  const pngFile = async () => {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    return new File([bytes], 'chart.png', { type: 'image/png' });
  };
  const upload = (app: ReturnType<typeof setup>['app'], id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return app.request(`/api/trades/${id}/screenshot`, { method: 'POST', body: fd });
  };
  const create = async (app: ReturnType<typeof setup>['app']) =>
    (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

  it('uploads, serves, and deletes a screenshot', async () => {
    const { app } = setup();
    const created = await create(app);

    const up = await upload(app, created.id, await pngFile());
    expect(up.status).toBe(204);

    const get = await app.request(`/api/trades/${created.id}/screenshot`);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/webp');
    expect(get.headers.get('cache-control')).toContain('no-store');

    const del = await app.request(`/api/trades/${created.id}/screenshot`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect((await app.request(`/api/trades/${created.id}/screenshot`)).status).toBe(404);
  });

  it('GET returns 404 when there is no screenshot', async () => {
    const { app } = setup();
    const created = await create(app);
    expect((await app.request(`/api/trades/${created.id}/screenshot`)).status).toBe(404);
  });

  it('upload to a nonexistent trade returns 404', async () => {
    const { app } = setup();
    expect((await upload(app, 99999, await pngFile())).status).toBe(404);
  });

  it('rejects a non-image upload with 400', async () => {
    const { app } = setup();
    const created = await create(app);
    const bad = new File([Buffer.from('not an image')], 'x.pdf', { type: 'application/pdf' });
    expect((await upload(app, created.id, bad)).status).toBe(400);
  });

  it('deletes the screenshot file when the trade is deleted', async () => {
    const { app } = setup();
    const created = await create(app);
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
    await app.request(`/api/trades/${created.id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });
    await upload(app, created.id, await pngFile());
    await app.request(`/api/trades/${created.id}`, { method: 'DELETE' });
    expect((await app.request(`/api/trades/${created.id}/screenshot`)).status).toBe(404);
  });
});

describe('T1mo capture route', () => {
  const png = async () => sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
  const okCapturer = (calls: string[][] = []): T1moCapturer => ({
    cacheMs: 15 * 60_000,
    configError: () => null,
    capture: async (tickers) => {
      calls.push(tickers);
      const out: Record<string, CaptureResult> = {};
      for (const t of tickers) out[t.toUpperCase()] = { signal: await png(), pixel: await png() };
      return out;
    },
  });
  const fill = async (app: ReturnType<typeof setup>['app'], ticker: string) => {
    const created = await (await app.request('/api/trades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ticker }) })).json();
    await app.request(`/api/trades/${created.id}/fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fillDate: '2026-08-04', fillPrice: 50 }) });
    return created.id as number;
  };

  it('400 when the feature is disabled (no capturer)', async () => {
    const { app } = setup(null);
    expect((await app.request('/api/t1mo/capture', { method: 'POST' })).status).toBe(400);
  });

  it('400 when misconfigured', async () => {
    const { app } = setup({ cacheMs: 900000, configError: () => 'T1MO_SIGNAL_CLIP must be "x,y,w,h"', capture: async () => ({}) });
    expect((await app.request('/api/t1mo/capture', { method: 'POST' })).status).toBe(400);
  });

  it('captures stale filled tickers, saves both variants, serves them, reports counts', async () => {
    const calls: string[][] = [];
    const { app } = setup(okCapturer(calls));
    const id = await fill(app, 'aapl');
    const res = await app.request('/api/t1mo/capture', { method: 'POST' });
    expect(res.status).toBe(200);
    const jsonRes = await res.json();
    expect(jsonRes.captured).toBe(1);
    expect(calls[0]).toEqual(['AAPL']);
    const sig = await app.request(`/api/trades/${id}/screenshot?variant=signal`);
    expect(sig.status).toBe(200);
    expect(sig.headers.get('content-type')).toBe('image/webp');
    const pix = await app.request(`/api/trades/${id}/screenshot?variant=pixel`);
    expect(pix.status).toBe(200);
  });

  it('skips fresh tickers on a second run (no re-capture)', async () => {
    const calls: string[][] = [];
    const { app } = setup(okCapturer(calls));
    await fill(app, 'aapl');
    await app.request('/api/t1mo/capture', { method: 'POST' });
    const second = await (await app.request('/api/t1mo/capture', { method: 'POST' })).json();
    expect(second.captured).toBe(0);
    expect(second.skipped).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('reports ok:false when the capturer returns an error for a ticker', async () => {
    const errCapturer: T1moCapturer = { cacheMs: 900000, configError: () => null, capture: async (t) => Object.fromEntries(t.map((x) => [x.toUpperCase(), { error: 'boom' }])) };
    const { app } = setup(errCapturer);
    await fill(app, 'aapl');
    const j = await (await app.request('/api/t1mo/capture', { method: 'POST' })).json();
    expect(j.failed).toBe(1);
    expect(j.results[0]).toMatchObject({ ticker: 'AAPL', ok: false });
  });

  it('409 when a capture is already in progress', async () => {
    const busy: T1moCapturer = { cacheMs: 900000, configError: () => null, capture: async () => { throw new ConflictError('busy'); } };
    const { app } = setup(busy);
    await fill(app, 'aapl');
    expect((await app.request('/api/t1mo/capture', { method: 'POST' })).status).toBe(409);
  });

  it('deletes both variants when the trade is exited', async () => {
    const { app } = setup(okCapturer());
    const id = await fill(app, 'aapl');
    await app.request('/api/t1mo/capture', { method: 'POST' });
    await app.request(`/api/trades/${id}/exit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exitPrice: 55, exitDate: '2026-08-20' }) });
    expect((await app.request(`/api/trades/${id}/screenshot?variant=signal`)).status).toBe(404);
    expect((await app.request(`/api/trades/${id}/screenshot?variant=pixel`)).status).toBe(404);
  });
});
