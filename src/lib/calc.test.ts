import { describe, it, expect } from 'vitest';
import { computeShares, computePnl, computeR, weekdaysBetween, isDudFlagged, deriveTrade } from './calc';
import type { TradeRow } from './types';

describe('computeShares', () => {
  it('floors fractional shares', () => {
    // 1000 / (50-45=5) = 200
    expect(computeShares(1000, 50, 45)).toBe(200);
    // 1000 / (10-7=3) = 333.33 -> 333
    expect(computeShares(1000, 10, 7)).toBe(333);
  });
});

describe('computePnl', () => {
  it('is positive on a win', () => { expect(computePnl(50, 55, 200)).toBe(1000); });
  it('is negative on a loss', () => { expect(computePnl(50, 45, 200)).toBe(-1000); });
});

describe('computeR', () => {
  it('divides pnl by risk', () => { expect(computeR(2300, 1000)).toBeCloseTo(2.3); });
});

describe('weekdaysBetween', () => {
  it('counts weekdays exclusive of start', () => {
    // Mon 2026-08-03 -> Fri 2026-08-07 = 4 weekdays
    expect(weekdaysBetween('2026-08-03', '2026-08-07')).toBe(4);
  });
  it('skips weekends', () => {
    // Fri 2026-08-07 -> Mon 2026-08-10 = 1 weekday
    expect(weekdaysBetween('2026-08-07', '2026-08-10')).toBe(1);
  });
  it('is zero for same day', () => { expect(weekdaysBetween('2026-08-07', '2026-08-07')).toBe(0); });
});

describe('isDudFlagged', () => {
  const base = { status: 'filled' as const, dudDecision: null, fillDate: '2026-08-03', verifyDays: 5 };
  it('flags when weekdays elapsed >= verifyDays', () => {
    // 2026-08-03 Mon -> 2026-08-10 Mon = 5 weekdays
    expect(isDudFlagged(base, '2026-08-10')).toBe(true);
  });
  it('does not flag one weekday short', () => {
    // -> Fri 08-07 = 4 weekdays
    expect(isDudFlagged(base, '2026-08-07')).toBe(false);
  });
  it('never flags pending', () => {
    expect(isDudFlagged({ ...base, status: 'pending', fillDate: null }, '2026-08-31')).toBe(false);
  });
  it('never flags once decided', () => {
    expect(isDudFlagged({ ...base, dudDecision: 'keep' }, '2026-08-31')).toBe(false);
  });
});

describe('deriveTrade', () => {
  const row: TradeRow = {
    id: 1, ticker: 'AAPL', upeti: 1000, entryPrice: 50, slPrice: 45, tpPrice: 60,
    entryType: 'buy_limit', entrySignal: 'btb', entryDate: '2026-08-03', earningsDate: '2026-08-25', notes: null, verifyDays: 5,
    status: 'exited', fillDate: '2026-08-03', dudDecision: null, exitPrice: 55, exitDate: '2026-08-20',
    createdAt: '2026-08-03T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z',
  };
  it('computes shares, pnl, r for exited', () => {
    const d = deriveTrade(row, '2026-08-21');
    expect(d.shares).toBe(200);
    expect(d.realizedPnl).toBe(1000);
    expect(d.rMultiple).toBeCloseTo(1);
    expect(d.dudFlagged).toBe(false);
  });
  it('leaves pnl null when not exited', () => {
    const d = deriveTrade({ ...row, status: 'filled', exitPrice: null, exitDate: null }, '2026-08-21');
    expect(d.realizedPnl).toBeNull();
    expect(d.rMultiple).toBeNull();
  });
});
