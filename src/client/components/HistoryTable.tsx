import { useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { SignalPill, SIGNAL_LABELS } from './SignalPill';
import { TradeDetails, NoteIcon } from './TradeDetails';
import { EditHistoryForm } from './EditHistoryForm';
import { ChartModal } from './ChartModal';
import { T1moLink } from './T1moLink';
import { formatDate } from '../format';
import { Modal } from './ExitForm';
import { useToast } from './Toast';
import type { TradeDTO } from '../../lib/types';

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);
// Off by default. Set VITE_ALLOW_HISTORY_EDIT=true to reveal per-row correction actions.
const ALLOW_EDIT = import.meta.env.VITE_ALLOW_HISTORY_EDIT === 'true';

/**
 * Clickable mini chart cell: shows the trade's screenshot thumbnail if one exists,
 * otherwise a dashed placeholder. Clicking either opens the Chart modal.
 */
function ChartThumb({ trade, version, onOpen }: { trade: TradeDTO; version: number; onOpen: (t: TradeDTO) => void }) {
  const [hasImage, setHasImage] = useState(true); // onError flips to placeholder
  // Re-show the <img> when the version changes (e.g. after an upload) so a newly
  // added chart appears even if this row had fallen back to the placeholder.
  useEffect(() => { setHasImage(true); }, [version]);
  return (
    <button
      onClick={() => onOpen(trade)}
      title="View / edit chart"
      className="block h-[50px] w-[75px] cursor-pointer overflow-hidden rounded border border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-700"
    >
      {hasImage ? (
        <img
          src={api.screenshotUrl(trade.id, version)}
          alt=""
          onError={() => setHasImage(false)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500">+ chart</span>
      )}
    </button>
  );
}

export function HistoryTable({ year }: { year: number | null }) {
  const [signal, setSignal] = useState<string>(''); // '' = all signals
  const q = useInfiniteQuery({
    queryKey: ['history', year, signal],
    queryFn: ({ pageParam }) => api.history(year as number, pageParam as string | null, 50, signal || null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: year !== null,
  });
  const [selected, setSelected] = useState<TradeDTO | null>(null);
  const [editing, setEditing] = useState<TradeDTO | null>(null);
  const [deleting, setDeleting] = useState<TradeDTO | null>(null);
  const [charting, setCharting] = useState<TradeDTO | null>(null);
  // Bumped when the Chart modal closes so row thumbnails re-fetch after an edit.
  const [thumbVersion, setThumbVersion] = useState(1);
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
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Trading History</h2>
        <select
          value={signal}
          onChange={(e) => setSignal(e.target.value)}
          className="cursor-pointer rounded-lg bg-slate-200 px-2 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">All signals</option>
          {Object.entries(SIGNAL_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <table className="w-full text-sm">
        <thead><tr>
          <th className={th}>Ticker</th><th className={th}>Signal</th><th className={th}>Entry</th>
          <th className={th}>Upet1</th><th className={th}>Exit</th><th className={th}>Realized P&L</th><th className={th}>Chart</th>{ALLOW_EDIT && <th className={th}>Actions</th>}
        </tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr
              key={t.id}
              onClick={() => setSelected(t)}
              className="cursor-pointer border-t border-slate-200 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800/60"
            >
              <td className="px-3 py-2 font-medium">
                <T1moLink ticker={t.ticker} />
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
                  {t.fillDate && <div className="text-[10px] text-slate-500 dark:text-slate-400">Date filled: {formatDate(t.fillDate)}</div>}
                </div>
              </td>
              <td className="px-3 py-2">{money(t.upeti)}</td>
              <td className="px-3 py-2">
                <div>{money(t.exitPrice)}</div>
                <div className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">{t.exitDate && formatDate(t.exitDate)}</div>
              </td>
              <td className={`px-3 py-2 font-semibold ${(t.realizedPnl ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {money(t.realizedPnl)} <span className="text-xs text-slate-500 dark:text-slate-400">({t.rMultiple != null ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple.toFixed(2)}R` : '—'})</span>
              </td>
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <ChartThumb trade={t} version={thumbVersion} onOpen={setCharting} />
              </td>
              {ALLOW_EDIT && (
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <span className="flex items-center gap-1">
                    <button onClick={() => setEditing(t)} title="Edit" aria-label="Edit" className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-slate-300 text-slate-900 dark:bg-slate-600 dark:text-slate-100"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setDeleting(t)} title="Delete" aria-label="Delete" className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-red-600 text-white"><X className="h-3.5 w-3.5" /></button>
                  </span>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={ALLOW_EDIT ? 8 : 7} className="px-3 py-3 text-slate-500 dark:text-slate-500">No exited trades yet.</td></tr>}
          <tr ref={sentinel} />
        </tbody>
      </table>
      {q.isFetchingNextPage && <div className="py-3 text-center text-slate-500 dark:text-slate-500 text-sm">Loading…</div>}
      {selected && <TradeDetails trade={selected} onClose={() => setSelected(null)} />}
      {editing && <EditHistoryForm trade={editing} onClose={() => setEditing(null)} />}
      {charting && <ChartModal trade={charting} onClose={() => { setCharting(null); setThumbVersion((v) => v + 1); }} />}
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
