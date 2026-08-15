// Company-profile provider, mirroring the quote provider: injected via Deps, returns
// null (never throws) when there's no API key or the lookup fails, so the app degrades
// gracefully without FINNHUB_API_KEY. Profiles are never persisted — looked up live.
export type CompanyProfile = { name: string; industry: string | null };
export type ProfileProvider = (ticker: string) => Promise<CompanyProfile | null>;

const TICKER_RE = /^[A-Z]{1,10}$/;

export function createFinnhubProfileProvider(opts: {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ProfileProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  return async (rawTicker) => {
    if (!opts.apiKey) return null;
    const ticker = rawTicker.trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) return null;
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${opts.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      // profile2 returns {} for unknown symbols; name is the only field we require.
      const body = (await res.json()) as { name?: string; finnhubIndustry?: string };
      if (!body.name) return null;
      return { name: body.name, industry: body.finnhubIndustry || null };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
