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
