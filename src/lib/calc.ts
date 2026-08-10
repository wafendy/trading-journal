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
  const costBasis = row.fillPrice ?? row.entryPrice;
  const realizedPnl = exited ? computePnl(costBasis, row.exitPrice as number, shares) : null;
  const rMultiple = realizedPnl !== null ? computeR(realizedPnl, row.upeti) : null;
  return { ...row, shares, realizedPnl, rMultiple, dudFlagged: isDudFlagged(row, todayISO) };
}
