import type { TradeDTO, EntrySignal } from '../lib/types';

export interface SignalPerformance {
  signal: EntrySignal; pnl: number; totalR: number; tradeCount: number; winRate: number;
}
export interface Summary {
  totalPnl: number; totalR: number; tradeCount: number; winRate: number;
  equityCurve: { exitDate: string; cumulativePnl: number }[];
  bySignal: SignalPerformance[];
}
export interface HistoryPage { items: TradeDTO[]; nextCursor: string | null; }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}
const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

export const api = {
  years: () => fetch('/api/years').then(json<number[]>),
  summary: (year: number, fromMonth?: number | null, toMonth?: number | null) =>
    fetch(`/api/summary?year=${year}${fromMonth ? `&from=${fromMonth}&to=${toMonth ?? 12}` : ''}`).then(json<Summary>),
  open: (status: 'pending' | 'filled') => fetch(`/api/trades?status=${status}`).then(json<TradeDTO[]>),
  history: (year: number, cursor: string | null, limit = 50, signal?: string | null) =>
    fetch(`/api/trades/history?year=${year}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${signal ? `&signal=${signal}` : ''}`).then(json<HistoryPage>),
  settings: () => fetch('/api/settings').then(json<{ upeti: number; verifyDays: number }>),
  updateSettings: (b: { upeti?: number; verifyDays?: number }) =>
    fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(json<{ upeti: number; verifyDays: number }>),
  earnings: (ticker: string) =>
    fetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`).then(json<{ earningsDate: string | null }>),
  t1moThumbUrl: (id: number, variant: 'signal' | 'pixel', version: number) => `/api/trades/${id}/screenshot?variant=${variant}&v=${version}`,
  captureT1mo: () =>
    fetch('/api/t1mo/capture', { method: 'POST' })
      .then((r) => r.json() as Promise<{ results: { ticker: string; ok: boolean; error?: string }[]; captured: number; failed: number; skipped: number }>),
  // Bounded by a client-side timeout so a hung request can't wedge a batch fetch.
  quote: (ticker: string) =>
    fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(8000) }).then(json<{ price: number | null }>),
  create: (b: unknown) => post('/api/trades', b).then(json<TradeDTO>),
  patch: (id: number, b: unknown) => fetch(`/api/trades/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(json<TradeDTO>),
  fill: (id: number, fillDate: string, fillPrice: number, fillShares: number) => post(`/api/trades/${id}/fill`, { fillDate, fillPrice, fillShares }).then(json<TradeDTO>),
  cancel: (id: number) => post(`/api/trades/${id}/cancel`).then((r) => { if (!r.ok) throw new Error('cancel failed'); }),
  remove: (id: number) => fetch(`/api/trades/${id}`, { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error('delete failed'); }),
  exit: (id: number, exitPrice: number, exitDate: string) => post(`/api/trades/${id}/exit`, { exitPrice, exitDate }).then(json<TradeDTO>),
  dudDecision: (id: number, b: unknown) => post(`/api/trades/${id}/dud-decision`, b).then(json<TradeDTO>),
  // Screenshot: URL carries a version param to bust the no-store image cache after edits.
  screenshotUrl: (id: number, version: number) => `/api/trades/${id}/screenshot?v=${version}`,
  uploadScreenshot: (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`/api/trades/${id}/screenshot`, { method: 'POST', body: fd })
      .then((r) => { if (!r.ok) throw new Error('upload failed'); });
  },
  deleteScreenshot: (id: number) =>
    fetch(`/api/trades/${id}/screenshot`, { method: 'DELETE' })
      .then((r) => { if (!r.ok) throw new Error('delete failed'); }),
};
