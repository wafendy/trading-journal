const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function selectNextEarningsDate(calendar: { date: string }[], todayISO: string): string | null {
  const upcoming = calendar
    .map((e) => e.date)
    .filter((d) => typeof d === 'string' && ISO.test(d) && d >= todayISO)
    .sort();
  return upcoming[0] ?? null;
}

export type EarningsProvider = (ticker: string, todayISO: string) => Promise<string | null>;

const TICKER_RE = /^[A-Z]{1,10}$/;

function plusDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function createFinnhubProvider(opts: {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): EarningsProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  return async (rawTicker, todayISO) => {
    if (!opts.apiKey) return null;
    const ticker = rawTicker.trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) return null;
    const to = plusDaysISO(todayISO, 120);
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${todayISO}&to=${to}&symbol=${ticker}&token=${opts.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as { earningsCalendar?: { date: string }[] };
      return selectNextEarningsDate(body.earningsCalendar ?? [], todayISO);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
