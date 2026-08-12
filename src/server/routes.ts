import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { TradeRepo } from './repository';
import { NotFoundError, ConflictError } from './repository';
import { createTradeSchema, patchTradeSchema, fillSchema, exitSchema, dudDecisionSchema, settingsSchema } from './validation';
import { deriveTrade, computePnl, computeShares, computeR } from '../lib/calc';
import type { TradeRow, EntrySignal } from '../lib/types';
import type { EarningsProvider } from './earnings';

export interface Deps { repo: TradeRepo; now: () => string; getNextEarnings: EarningsProvider; }

export function registerRoutes(api: Hono, { repo, now, getNextEarnings }: Deps): void {
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
  return c.json({ error: 'internal error' }, 500);
}
