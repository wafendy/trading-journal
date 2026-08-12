import { describe, it, expect } from 'vitest';
import { createTradeSchema, patchTradeSchema, dudDecisionSchema, exitSchema, fillSchema, settingsSchema } from './validation';

describe('createTradeSchema', () => {
  const valid = { ticker: 'aapl', upeti: 1000, entryPrice: 50, slPrice: 45, entryType: 'buy_limit', entrySignal: 'btb', earningsDate: '2026-08-25', verifyDays: 5 };
  it('accepts valid input and uppercases ticker', () => {
    const r = createTradeSchema.parse(valid);
    expect(r.ticker).toBe('AAPL');
  });
  it('rejects sl >= entry', () => {
    expect(() => createTradeSchema.parse({ ...valid, slPrice: 55 })).toThrow();
  });
  it('rejects bad verifyDays', () => {
    expect(() => createTradeSchema.parse({ ...valid, verifyDays: 3 })).toThrow();
  });
  it('rejects bad signal', () => {
    expect(() => createTradeSchema.parse({ ...valid, entrySignal: 'nope' })).toThrow();
  });
  it('rejects missing earningsDate (required on create)', () => {
    const { earningsDate, ...withoutEarnings } = valid;
    void earningsDate;
    expect(() => createTradeSchema.parse(withoutEarnings)).toThrow();
  });
  it('rejects tp below entry price', () => {
    expect(() => createTradeSchema.parse({ ...valid, tpPrice: 49 })).toThrow();
  });
  it('defaults direction to long', () => {
    expect(createTradeSchema.parse(valid).direction).toBe('long');
  });
  it('accepts a short with SL above and TP below entry', () => {
    const short = { ...valid, direction: 'short', slPrice: 55, tpPrice: 40, entryType: 'sell_limit' };
    expect(createTradeSchema.parse(short).direction).toBe('short');
  });
  it('rejects a short whose SL is below entry', () => {
    expect(() => createTradeSchema.parse({ ...valid, direction: 'short', slPrice: 45 })).toThrow();
  });
  it('rejects a short whose TP is above entry', () => {
    expect(() => createTradeSchema.parse({ ...valid, direction: 'short', slPrice: 55, tpPrice: 60, entryType: 'sell_limit' })).toThrow();
  });
  it('accepts tp at or above entry price, and null tp', () => {
    expect(createTradeSchema.parse({ ...valid, tpPrice: 60 }).tpPrice).toBe(60);
    expect(createTradeSchema.parse({ ...valid, tpPrice: 50 }).tpPrice).toBe(50); // == entry allowed
    expect(createTradeSchema.parse({ ...valid, tpPrice: null }).tpPrice).toBeNull();
  });
});

describe('patchTradeSchema', () => {
  it('accepts an earningsDate-only patch', () => {
    const r = patchTradeSchema.parse({ earningsDate: '2026-09-01' });
    expect(r.earningsDate).toBe('2026-09-01');
  });
  it('accepts history-correction fields (exit values + basis)', () => {
    const r = patchTradeSchema.parse({ exitPrice: 55.1, exitDate: '2026-08-20', fillPrice: 50, fillShares: 18 });
    expect(r).toEqual({ exitPrice: 55.1, exitDate: '2026-08-20', fillPrice: 50, fillShares: 18 });
  });
  it('accepts null fillShares (revert to computed size)', () => {
    expect(patchTradeSchema.parse({ fillShares: null }).fillShares).toBeNull();
  });
  it('rejects a non-positive exitPrice and a bad exitDate', () => {
    expect(() => patchTradeSchema.parse({ exitPrice: 0 })).toThrow();
    expect(() => patchTradeSchema.parse({ exitDate: '08/20/2026' })).toThrow();
  });
});

describe('dudDecisionSchema', () => {
  it('accepts keep without prices', () => {
    expect(dudDecisionSchema.parse({ decision: 'keep' })).toEqual({ decision: 'keep' });
  });
  it('requires prices for exit', () => {
    expect(() => dudDecisionSchema.parse({ decision: 'exit' })).toThrow();
    expect(dudDecisionSchema.parse({ decision: 'exit', exitPrice: 55, exitDate: '2026-08-20' }).decision).toBe('exit');
  });
});

describe('exitSchema', () => {
  it('requires price and date', () => {
    expect(() => exitSchema.parse({ exitPrice: 55 })).toThrow();
  });
});

describe('fillSchema', () => {
  it('requires fillDate and positive fillPrice', () => {
    expect(fillSchema.parse({ fillDate: '2026-08-04', fillPrice: 52 })).toEqual({ fillDate: '2026-08-04', fillPrice: 52 });
    expect(() => fillSchema.parse({ fillDate: '2026-08-04' })).toThrow();
    expect(() => fillSchema.parse({ fillDate: '2026-08-04', fillPrice: 0 })).toThrow();
  });
});

describe('settingsSchema', () => {
  it('accepts partial updates', () => {
    expect(settingsSchema.parse({ upeti: 250 })).toEqual({ upeti: 250 });
    expect(settingsSchema.parse({ verifyDays: 7 })).toEqual({ verifyDays: 7 });
    expect(settingsSchema.parse({})).toEqual({});
  });
  it('rejects bad values', () => {
    expect(() => settingsSchema.parse({ upeti: -1 })).toThrow();
    expect(() => settingsSchema.parse({ verifyDays: 3 })).toThrow();
  });
});
