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
  fill(id: number, fillDate: string, fillPrice: number, fillShares: number | null): TradeRow;
  cancel(id: number): void;
  deleteExited(id: number): void;
  exit(id: number, exitPrice: number, exitDate: string): TradeRow;
  dudKeep(id: number): TradeRow;
  getSettings(): { upeti: number; verifyDays: number };
  setSettings(input: { upeti?: number; verifyDays?: number }): void;
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
        direction: input.direction, earningsDate: input.earningsDate, notes: input.notes ?? null, verifyDays: input.verifyDays, status: 'pending',
        fillDate: null, fillPrice: null, dudDecision: null, exitPrice: null, exitDate: null, createdAt: ts, updatedAt: ts,
      }).returning().get() as TradeRow;
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
    fill(id, fillDate, fillPrice, fillShares) {
      const t = require(id);
      if (t.status !== 'pending') throw new ConflictError('only pending orders can be filled');
      db.update(trades).set({ status: 'filled', fillDate, fillPrice, fillShares, updatedAt: now() }).where(eq(trades.id, id)).run();
      return require(id);
    },
    cancel(id) {
      const t = require(id);
      if (t.status !== 'pending') throw new ConflictError('only pending orders can be cancelled');
      db.delete(trades).where(eq(trades.id, id)).run();
    },
    deleteExited(id) {
      const t = require(id);
      if (t.status !== 'exited') throw new ConflictError('only exited (history) trades can be deleted');
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
  };
}
