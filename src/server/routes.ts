import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { TradeRepo } from './repository';
import { NotFoundError, ConflictError } from './repository';
import { createTradeSchema, patchTradeSchema, fillSchema, exitSchema, dudDecisionSchema, settingsSchema } from './validation';
import { deriveTrade, computePnl, computeShares, computeR } from '../lib/calc';
import type { TradeRow, EntrySignal } from '../lib/types';
import type { EarningsProvider } from './earnings';
import type { QuoteProvider } from './quotes';
import { BadRequestError, type ScreenshotStore } from './screenshots';
import type { T1moCapturer, CaptureResult } from './t1moCapture';

export interface Deps { repo: TradeRepo; now: () => string; getNextEarnings: EarningsProvider; getQuote: QuoteProvider; screenshots: ScreenshotStore; t1moCapturer: T1moCapturer | null; }

// A multipart upload value that behaves like a File (has size/type + arrayBuffer()).
// Duck-typed so it works across realms (Node global File vs jsdom's in tests).
type UploadedFile = { size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> };
function isUploadedFile(v: unknown): v is UploadedFile {
  return typeof v === 'object' && v !== null
    && typeof (v as UploadedFile).size === 'number'
    && typeof (v as UploadedFile).type === 'string'
    && typeof (v as UploadedFile).arrayBuffer === 'function';
}

export function registerRoutes(api: Hono, { repo, now, getNextEarnings, getQuote, screenshots, t1moCapturer }: Deps): void {
  const today = () => now().slice(0, 10);
  const dto = (row: TradeRow) => deriveTrade(row, today());

  api.get('/trades', (c) => {
    const status = c.req.query('status');
    if (status !== 'pending' && status !== 'filled') return c.json({ error: 'status must be pending or filled' }, 400);
    return c.json(repo.list(status).map(dto));
  });

  api.get('/earnings', async (c) => {
    const ticker = (c.req.query('ticker') ?? '').trim().toUpperCase();
    if (!/^[A-Z]{1,10}$/.test(ticker)) return c.json({ error: 'valid ticker required' }, 400);
    const earningsDate = await getNextEarnings(ticker, now().slice(0, 10));
    return c.json({ earningsDate });
  });

  // Live price lookup for unrealized-P&L estimates. Never persisted; price is null
  // without FINNHUB_API_KEY or for an unknown symbol.
  api.get('/quote', async (c) => {
    const ticker = (c.req.query('ticker') ?? '').trim().toUpperCase();
    if (!/^[A-Z]{1,10}$/.test(ticker)) return c.json({ error: 'valid ticker required' }, 400);
    const price = await getQuote(ticker);
    return c.json({ price });
  });

  api.get('/trades/history', (c) => {
    const year = Number(c.req.query('year'));
    const limit = Number(c.req.query('limit') ?? '50');
    const cursorRaw = c.req.query('cursor');
    const cursor = cursorRaw ? cursorRaw : null;
    const signal = c.req.query('signal') || null;
    if (!Number.isInteger(year)) return c.json({ error: 'year required' }, 400);
    const { items, nextCursor } = repo.history(year, cursor, limit, signal);
    return c.json({ items: items.map(dto), nextCursor });
  });

  api.get('/years', (c) => c.json(repo.years()));

  api.get('/summary', (c) => {
    const year = Number(c.req.query('year'));
    if (!Number.isInteger(year)) return c.json({ error: 'year required' }, 400);
    // Optional month range (1-12), inclusive. Missing/invalid endpoints default to
    // the whole year, so no params == all year (backward compatible).
    const clampMonth = (v: number, dflt: number) => (Number.isInteger(v) && v >= 1 && v <= 12 ? v : dflt);
    const fromMonth = clampMonth(Number(c.req.query('from')), 1);
    const toMonth = clampMonth(Number(c.req.query('to')), 12);
    // gather all exited for year
    const all: TradeRow[] = [];
    let cursor: string | null = null;
    do {
      const page = repo.history(year, cursor, 500);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    const inRange = all.filter((r) => {
      const m = Number((r.exitDate as string).slice(5, 7));
      return m >= fromMonth && m <= toMonth;
    });
    // ascending for cumulative
    const asc = [...inRange].sort((a, b) => a.exitDate!.localeCompare(b.exitDate!) || a.id - b.id);
    // Cost basis is the actual fill price when known, else the planned entry —
    // identical to deriveTrade, so summary matches the history table.
    const pnlOf = (r: TradeRow) => {
      const shares = r.fillShares ?? computeShares(r.upeti, r.entryPrice, r.slPrice, r.direction);
      return computePnl(r.fillPrice ?? r.entryPrice, r.exitPrice as number, shares, r.direction);
    };
    let cum = 0;
    const equityCurve = asc.map((r) => {
      cum += pnlOf(r);
      return { exitDate: r.exitDate as string, cumulativePnl: cum };
    });
    const totalPnl = equityCurve.length ? equityCurve[equityCurve.length - 1]!.cumulativePnl : 0;
    const totalR = asc.reduce((s, r) => s + computeR(pnlOf(r), r.upeti), 0);
    const wins = asc.filter((r) => pnlOf(r) > 0).length;
    const tradeCount = asc.length;

    // Per-signal breakdown: same four metrics, only signals with ≥1 trade,
    // sorted by P&L descending.
    const groups = new Map<EntrySignal, TradeRow[]>();
    for (const r of asc) {
      const list = groups.get(r.entrySignal) ?? [];
      list.push(r);
      groups.set(r.entrySignal, list);
    }
    const bySignal = [...groups.entries()]
      .map(([signal, rows]) => {
        const pnl = rows.reduce((s, r) => s + pnlOf(r), 0);
        const sigWins = rows.filter((r) => pnlOf(r) > 0).length;
        return {
          signal,
          pnl,
          totalR: rows.reduce((s, r) => s + computeR(pnlOf(r), r.upeti), 0),
          tradeCount: rows.length,
          winRate: rows.length ? sigWins / rows.length : 0,
        };
      })
      .sort((a, b) => b.pnl - a.pnl);

    return c.json({ totalPnl, totalR, tradeCount, winRate: tradeCount ? wins / tradeCount : 0, equityCurve, bySignal });
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
    const { fillDate, fillPrice, fillShares } = fillSchema.parse(await c.req.json());
    return c.json(dto(repo.fill(Number(c.req.param('id')), fillDate, fillPrice, fillShares ?? null)));
  });

  api.post('/trades/:id/cancel', async (c) => {
    const id = Number(c.req.param('id'));
    repo.cancel(id);
    await screenshots.remove(id); // best-effort; remove() never throws for missing files
    return c.body(null, 204);
  });

  // Permanently delete an exited (history) trade.
  api.delete('/trades/:id', async (c) => {
    const id = Number(c.req.param('id'));
    repo.deleteExited(id);
    await screenshots.remove(id);
    return c.body(null, 204);
  });

  const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

  api.post('/trades/:id/screenshot', async (c) => {
    const id = Number(c.req.param('id'));
    if (!repo.getById(id)) throw new NotFoundError(`trade ${id} not found`);
    const form = await c.req.parseBody();
    const file = form['file'];
    // Duck-typed rather than `instanceof File`: parseBody's File and the caller's File
    // can come from different realms (e.g. jsdom in tests), which breaks instanceof.
    if (!isUploadedFile(file)) throw new BadRequestError('file is required');
    if (file.size > MAX_SCREENSHOT_BYTES) throw new BadRequestError('image exceeds 10MB');
    const bytes = Buffer.from(await file.arrayBuffer());
    await screenshots.save(id, bytes, file.type); // throws BadRequestError for a bad type
    return c.body(null, 204);
  });

  api.get('/trades/:id/screenshot', async (c) => {
    const id = Number(c.req.param('id'));
    const variant = c.req.query('variant');
    const bytes = variant === 'signal' || variant === 'pixel'
      ? await screenshots.readVariant(id, variant)
      : await screenshots.read(id);
    if (!bytes) return c.body(null, 404);
    // Copy into a standalone ArrayBuffer and return a plain Response (avoids Hono's
    // c.body Buffer/ArrayBufferLike overload friction).
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Response(ab as ArrayBuffer, { status: 200, headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' } });
  });

  api.delete('/trades/:id/screenshot', async (c) => {
    await screenshots.remove(Number(c.req.param('id')));
    return c.body(null, 204);
  });

  // On-demand T1mo signal/pixel capture for all active positions (stale ones only).
  api.post('/t1mo/capture', async (c) => {
    if (!t1moCapturer) return c.json({ error: 'T1mo capture is disabled (set VITE_T1MO_CAPTURE=true)' }, 400);
    const cfgErr = t1moCapturer.configError();
    if (cfgErr) return c.json({ error: cfgErr }, 400);

    const filled = repo.list('filled');
    const cutoff = t1moCapturer.cacheMs;
    const stale: typeof filled = [];
    for (const t of filled) {
      const sAge = await screenshots.ageMs(t.id, 'signal');
      const pAge = await screenshots.ageMs(t.id, 'pixel');
      if (sAge == null || pAge == null || sAge > cutoff || pAge > cutoff) stale.push(t);
    }
    const tickers = [...new Set(stale.map((t) => t.ticker.toUpperCase()))];
    const captured: Record<string, CaptureResult> = tickers.length ? await t1moCapturer.capture(tickers) : {};

    const results: { ticker: string; ok: boolean; error?: string }[] = [];
    let ok = 0, failed = 0;
    for (const t of stale) {
      const r = captured[t.ticker.toUpperCase()];
      if (!r) { failed++; results.push({ ticker: t.ticker, ok: false, error: 'no result' }); continue; }
      if ('error' in r) { failed++; results.push({ ticker: t.ticker, ok: false, error: r.error }); continue; }
      await screenshots.saveVariant(t.id, 'signal', r.signal, 'image/png');
      await screenshots.saveVariant(t.id, 'pixel', r.pixel, 'image/png');
      ok++; results.push({ ticker: t.ticker, ok: true });
    }
    return c.json({ results, captured: ok, failed, skipped: filled.length - stale.length });
  });

  // Exiting a position discards its auto-captured T1mo snapshots (best-effort, idempotent).
  const removeT1moVariants = async (id: number) => {
    await screenshots.removeVariant(id, 'signal');
    await screenshots.removeVariant(id, 'pixel');
  };

  api.post('/trades/:id/exit', async (c) => {
    const { exitPrice, exitDate } = exitSchema.parse(await c.req.json());
    const id = Number(c.req.param('id'));
    const out = dto(repo.exit(id, exitPrice, exitDate));
    await removeT1moVariants(id);
    return c.json(out);
  });

  api.post('/trades/:id/dud-decision', async (c) => {
    const input = dudDecisionSchema.parse(await c.req.json());
    const id = Number(c.req.param('id'));
    if (input.decision === 'keep') return c.json(dto(repo.dudKeep(id)));
    const out = dto(repo.exit(id, input.exitPrice, input.exitDate));
    await removeT1moVariants(id);
    return c.json(out);
  });

  api.get('/settings', (c) => c.json(repo.getSettings()));
  api.patch('/settings', async (c) => {
    const input = settingsSchema.parse(await c.req.json());
    repo.setSettings(input);
    return c.json(repo.getSettings());
  });
}

export function errorHandler(err: Error, c: import('hono').Context) {
  if (err instanceof ZodError) return c.json({ error: 'validation', issues: err.issues }, 400);
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
  if (err instanceof BadRequestError) return c.json({ error: err.message }, 400);
  return c.json({ error: 'internal error' }, 500);
}
