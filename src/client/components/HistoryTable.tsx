import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api';
import { SignalPill } from './SignalPill';
import { TradeDetails, NoteIcon } from './TradeDetails';
import { EditHistoryForm } from './EditHistoryForm';
import type { TradeDTO } from '../../lib/types';

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);
// Off by default. Set VITE_ALLOW_HISTORY_EDIT=true to reveal per-row correction actions.
const ALLOW_EDIT = import.meta.env.VITE_ALLOW_HISTORY_EDIT === 'true';

export function HistoryTable({ year }: { year: number | null }) {
  const q = useInfiniteQuery({
    queryKey: ['history', year],
    queryFn: ({ pageParam }) => api.history(year as number, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: year !== null,
  });
  const [selected, setSelected] = useState<TradeDTO | null>(null);
  const [editing, setEditing] = useState<TradeDTO | null>(null);
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
      <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Trading History</h2>
      <table className="w-full text-sm">
        <thead><tr>
          <th className={th}>Ticker</th><th className={th}>Entry</th><th className={th}>SL</th><th className={th}>TP</th><th className={th}>Shares</th>
          <th className={th}>Exit</th><th className={th}>Signal</th><th className={th}>UPETI</th><th className={th}>Realized P&L</th>{ALLOW_EDIT && <th className={th}>Actions</th>}
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
                {t.direction === 'short' && (
                  <span className="ml-1.5 rounded bg-rose-200 px-1 py-0.5 text-[10px] font-semibold text-rose-900 dark:bg-rose-500/30 dark:text-rose-200" title="Short position">SHORT</span>
                )}
                {t.notes && <NoteIcon />}
              </td>
              <td className="px-3 py-2">
                <div>{money(t.entryPrice)}</div>
                <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                  {t.fillDate ? `filled @ ${money(t.fillPrice)} · ${t.fillDate}` : '—'}
                </div>
              </td>
              <td className="px-3 py-2">{money(t.slPrice)}</td>
              <td className="px-3 py-2">{money(t.tpPrice)}</td>
              <td className="px-3 py-2">{t.shares}</td>
              <td className="px-3 py-2">
                <div>{money(t.exitPrice)}</div>
                <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">{t.exitDate}</div>
              </td>
              <td className="px-3 py-2"><SignalPill signal={t.entrySignal} /></td>
              <td className="px-3 py-2">{money(t.upeti)}</td>
              <td className={`px-3 py-2 font-semibold ${(t.realizedPnl ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {money(t.realizedPnl)} <span className="text-xs text-slate-500 dark:text-slate-400">({t.rMultiple != null ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple.toFixed(2)}R` : '—'})</span>
              </td>
              {ALLOW_EDIT && (
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setEditing(t)} className="cursor-pointer rounded bg-slate-300 px-2 py-0.5 text-xs text-slate-900 dark:bg-slate-600 dark:text-slate-100">Edit</button>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={ALLOW_EDIT ? 10 : 9} className="px-3 py-3 text-slate-500 dark:text-slate-500">No exited trades yet.</td></tr>}
          <tr ref={sentinel} />
        </tbody>
      </table>
      {q.isFetchingNextPage && <div className="py-3 text-center text-slate-500 dark:text-slate-500 text-sm">Loading…</div>}
      {selected && <TradeDetails trade={selected} onClose={() => setSelected(null)} />}
      {editing && <EditHistoryForm trade={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
