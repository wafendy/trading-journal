import { describe, it, expect } from 'vitest';
import { createFinnhubProfileProvider } from './profile';

const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe('createFinnhubProfileProvider', () => {
  it('returns null when no api key (and does not call fetch)', async () => {
    let called = false;
    const p = createFinnhubProfileProvider({ apiKey: undefined, fetchImpl: (async () => { called = true; return okResponse({}); }) as unknown as typeof fetch });
    expect(await p('NVDA')).toBeNull();
    expect(called).toBe(false);
  });
  it('returns name + industry', async () => {
    const p = createFinnhubProfileProvider({ apiKey: 'k', fetchImpl: (async () => okResponse({ name: 'NVIDIA Corp', finnhubIndustry: 'Semiconductors' })) as unknown as typeof fetch });
    expect(await p('nvda')).toEqual({ name: 'NVIDIA Corp', industry: 'Semiconductors' });
  });
  it('nulls industry when missing but keeps name', async () => {
    const p = createFinnhubProfileProvider({ apiKey: 'k', fetchImpl: (async () => okResponse({ name: 'Foo Inc' })) as unknown as typeof fetch });
    expect(await p('FOO')).toEqual({ name: 'Foo Inc', industry: null });
  });
  it('returns null for unknown symbol (empty body / no name)', async () => {
    const p = createFinnhubProfileProvider({ apiKey: 'k', fetchImpl: (async () => okResponse({})) as unknown as typeof fetch });
    expect(await p('ZZZZ')).toBeNull();
  });
  it('rejects invalid tickers without fetching', async () => {
    let called = false;
    const p = createFinnhubProfileProvider({ apiKey: 'k', fetchImpl: (async () => { called = true; return okResponse({}); }) as unknown as typeof fetch });
    expect(await p('BAD TICKER!')).toBeNull();
    expect(called).toBe(false);
  });
  it('returns null on non-ok response and when fetch throws', async () => {
    const bad = createFinnhubProfileProvider({ apiKey: 'k', fetchImpl: (async () => ({ ok: false }) as Response) as unknown as typeof fetch });
    expect(await bad('NVDA')).toBeNull();
    const threw = createFinnhubProfileProvider({ apiKey: 'k', fetchImpl: (async () => { throw new Error('network'); }) as unknown as typeof fetch });
    expect(await threw('NVDA')).toBeNull();
  });
});
