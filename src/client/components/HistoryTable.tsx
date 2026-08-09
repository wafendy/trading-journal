import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api';
import { SignalPill } from './SignalPill';
import { TradeDetails, NoteIcon } from './TradeDetails';
import type { TradeDTO } from '../../lib/types';

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

export function HistoryTable({ year }: { year: number }) {
  const q = useInfiniteQuery({
    queryKey: ['history', year],
    queryFn: ({ pageParam }) => api.history(year, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const [selected, setSelected] = useState<TradeDTO | null>(null);
  const sentinel = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!sentinel.current) return;
    const obs = new IntersectionObserver((e) => { if (e[0]!.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); });
    obs.observe(sentinel.current);
    return () => obs.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q]);

  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const th = 'px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400';
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Trading History <span className="font-normal text-slate-400">— click a row for notes &amp; details</span></h2>
      <table className="w-full text-sm">
        <thead><tr>
          <th className={th}>Ticker</th><th className={th}>Entry</th><th className={th}>SL</th><th className={th}>TP</th><th className={th}>Shares</th>
          <th className={th}>Exit</th><th className={th}>Signal</th><th className={th}>Realized P&L</th>
        </tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr
              key={t.id}
              onClick={() => setSelected(t)}
              className="cursor-pointer border-t border-slate-200 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800/60"
            >
              <td className="px-3 py-2 font-medium">
                {t.ticker}
                {t.notes && <NoteIcon />}
              </td>
              <td className="px-3 py-2">
                <div>{money(t.entryPrice)}</div>
                <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">{t.entryDate}</div>
              </td>
              <td className="px-3 py-2">{money(t.slPrice)}</td>
              <td className="px-3 py-2">{money(t.tpPrice)}</td>
              <td className="px-3 py-2">{t.shares}</td>
              <td className="px-3 py-2">
                <div>{money(t.exitPrice)}</div>
                <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">{t.exitDate}</div>
              </td>
              <td className="px-3 py-2"><SignalPill signal={t.entrySignal} /></td>
              <td className={`px-3 py-2 font-semibold ${(t.realizedPnl ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {money(t.realizedPnl)} <span className="text-xs text-slate-500 dark:text-slate-400">({t.rMultiple != null ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple.toFixed(2)}R` : '—'})</span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-slate-500 dark:text-slate-500">No trades for {year}</td></tr>}
          <tr ref={sentinel} />
        </tbody>
      </table>
      {q.isFetchingNextPage && <div className="py-3 text-center text-slate-500 dark:text-slate-500 text-sm">Loading…</div>}
      {selected && <TradeDetails trade={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
