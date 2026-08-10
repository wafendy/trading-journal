import { describe, it, expect } from 'vitest';
import { selectNextEarningsDate, createFinnhubProvider } from './earnings';

describe('selectNextEarningsDate', () => {
  const today = '2026-08-09';
  it('picks the earliest upcoming date', () => {
    const cal = [{ date: '2026-11-19' }, { date: '2026-09-01' }, { date: '2027-02-10' }];
    expect(selectNextEarningsDate(cal, today)).toBe('2026-09-01');
  });
  it('ignores past dates', () => {
    const cal = [{ date: '2026-05-01' }, { date: '2026-08-20' }];
    expect(selectNextEarningsDate(cal, today)).toBe('2026-08-20');
  });
  it('includes today', () => {
    expect(selectNextEarningsDate([{ date: '2026-08-09' }], today)).toBe('2026-08-09');
  });
  it('returns null for empty or all-past', () => {
    expect(selectNextEarningsDate([], today)).toBeNull();
    expect(selectNextEarningsDate([{ date: '2020-01-01' }], today)).toBeNull();
  });
  it('ignores malformed dates', () => {
    expect(selectNextEarningsDate([{ date: 'n/a' }, { date: '2026-10-10' }], today)).toBe('2026-10-10');
  });
});

const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe('createFinnhubProvider', () => {
  const today = '2026-08-09';
  it('returns null when no api key (and does not call fetch)', async () => {
    let called = false;
    const p = createFinnhubProvider({ apiKey: undefined, fetchImpl: (async () => { called = true; return okResponse({}); }) as unknown as typeof fetch });
    expect(await p('AAPL', today)).toBeNull();
    expect(called).toBe(false);
  });
  it('returns the next earnings date from the calendar', async () => {
    const fetchImpl = (async () => okResponse({ earningsCalendar: [{ date: '2026-09-01' }, { date: '2026-12-01' }] })) as unknown as typeof fetch;
    const p = createFinnhubProvider({ apiKey: 'k', fetchImpl });
    expect(await p('aapl', today)).toBe('2026-09-01');
  });
  it('rejects invalid tickers without fetching', async () => {
    let called = false;
    const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: (async () => { called = true; return okResponse({}); }) as unknown as typeof fetch });
    expect(await p('BAD TICKER!', today)).toBeNull();
    expect(called).toBe(false);
  });
  it('returns null on non-ok response', async () => {
    const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: (async () => ({ ok: false }) as Response) as unknown as typeof fetch });
    expect(await p('AAPL', today)).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: (async () => { throw new Error('network'); }) as unknown as typeof fetch });
    expect(await p('AAPL', today)).toBeNull();
  });
});
