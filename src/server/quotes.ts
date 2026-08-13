// Live-quote provider, mirroring the earnings provider: injected via Deps, returns
// null (never throws) when there's no API key or the lookup fails, so the app degrades
// gracefully without FINNHUB_API_KEY. Quotes are never persisted — callers compute
// unrealized P&L on the fly.
export type QuoteProvider = (ticker: string) => Promise<number | null>;

const TICKER_RE = /^[A-Z]{1,10}$/;

export function createFinnhubQuoteProvider(opts: {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): QuoteProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  return async (rawTicker) => {
    if (!opts.apiKey) return null;
    const ticker = rawTicker.trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) return null;
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${opts.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      // Finnhub /quote returns { c: current, h, l, o, pc, ... }. c is 0 for unknown symbols.
      const body = (await res.json()) as { c?: number };
      return typeof body.c === 'number' && body.c > 0 ? body.c : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
