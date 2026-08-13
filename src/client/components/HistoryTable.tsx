import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { SignalPill } from './SignalPill';
import { TradeDetails, NoteIcon } from './TradeDetails';
import { EditHistoryForm } from './EditHistoryForm';
import { Modal } from './ExitForm';
import { useToast } from './Toast';
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
  const [deleting, setDeleting] = useState<TradeDTO | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const del = useMutation({
    mutationFn: (id: number) => api.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['years'] });
      toast('Trade deleted');
      setDeleting(null);
    },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });
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
          <th className={th}>Ticker</th><th className={th}>Signal</th><th className={th}>Entry</th>
          <th className={th}>UPETI</th><th className={th}>Exit</th><th className={th}>Realized P&L</th>{ALLOW_EDIT && <th className={th}>Actions</th>}
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
              <td className="px-3 py-2"><SignalPill signal={t.entrySignal} /></td>
              <td className="px-3 py-2">
                <div className="leading-tight">
                  <div>{t.shares} @ {money(t.fillPrice ?? t.entryPrice)}</div>
                  <div className="text-[11px]">
                    <span className="text-red-600 dark:text-red-400">SL: {money(t.slPrice)}</span>
                    {t.tpPrice != null && <span className="ml-2 text-green-600 dark:text-green-400">TP: {money(t.tpPrice)}</span>}
                  </div>
                  {t.fillDate && <div className="text-[10px] text-slate-500 dark:text-slate-400">Date filled: {t.fillDate}</div>}
                </div>
              </td>
              <td className="px-3 py-2">{money(t.upeti)}</td>
              <td className="px-3 py-2">
                <div>{money(t.exitPrice)}</div>
                <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">{t.exitDate}</div>
              </td>
              <td className={`px-3 py-2 font-semibold ${(t.realizedPnl ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {money(t.realizedPnl)} <span className="text-xs text-slate-500 dark:text-slate-400">({t.rMultiple != null ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple.toFixed(2)}R` : '—'})</span>
              </td>
              {ALLOW_EDIT && (
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <span className="flex gap-2">
                    <button onClick={() => setEditing(t)} className="cursor-pointer rounded bg-slate-300 px-2 py-0.5 text-xs text-slate-900 dark:bg-slate-600 dark:text-slate-100">Edit</button>
                    <button onClick={() => setDeleting(t)} className="cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs text-white">Delete</button>
                  </span>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={ALLOW_EDIT ? 7 : 6} className="px-3 py-3 text-slate-500 dark:text-slate-500">No exited trades yet.</td></tr>}
          <tr ref={sentinel} />
        </tbody>
      </table>
      {q.isFetchingNextPage && <div className="py-3 text-center text-slate-500 dark:text-slate-500 text-sm">Loading…</div>}
      {selected && <TradeDetails trade={selected} onClose={() => setSelected(null)} />}
      {editing && <EditHistoryForm trade={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <Modal title={`Delete ${deleting.ticker} trade?`} onClose={() => setDeleting(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This permanently deletes this exited trade from your history and removes it from all P&amp;L totals. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setDeleting(null)} className="cursor-pointer rounded bg-slate-300 px-3 py-1 text-slate-900 dark:bg-slate-600 dark:text-slate-100">Keep</button>
            <button disabled={del.isPending} onClick={() => del.mutate(deleting.id)} className="cursor-pointer rounded bg-red-600 px-3 py-1 text-white disabled:cursor-not-allowed disabled:opacity-50">Delete</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
