import type { TradeDTO } from '../lib/types';

export interface Summary {
  totalPnl: number; totalR: number; tradeCount: number; winRate: number;
  equityCurve: { exitDate: string; cumulativePnl: number }[];
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
  summary: (year: number) => fetch(`/api/summary?year=${year}`).then(json<Summary>),
  open: (status: 'pending' | 'filled') => fetch(`/api/trades?status=${status}`).then(json<TradeDTO[]>),
  history: (year: number, cursor: string | null, limit = 50) =>
    fetch(`/api/trades/history?year=${year}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).then(json<HistoryPage>),
  settings: () => fetch('/api/settings').then(json<{ lastUpeti: number | null }>),
  create: (b: unknown) => post('/api/trades', b).then(json<TradeDTO>),
  patch: (id: number, b: unknown) => fetch(`/api/trades/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(json<TradeDTO>),
  fill: (id: number, fillDate: string) => post(`/api/trades/${id}/fill`, { fillDate }).then(json<TradeDTO>),
  cancel: (id: number) => post(`/api/trades/${id}/cancel`).then((r) => { if (!r.ok) throw new Error('cancel failed'); }),
  exit: (id: number, exitPrice: number, exitDate: string) => post(`/api/trades/${id}/exit`, { exitPrice, exitDate }).then(json<TradeDTO>),
  dudDecision: (id: number, b: unknown) => post(`/api/trades/${id}/dud-decision`, b).then(json<TradeDTO>),
};
