import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Modal } from './ExitForm';
import { useToast } from './Toast';
import { SIGNAL_LABELS, SIGNALS_BY_DIRECTION } from './SignalPill';
import type { TradeDTO, EntrySignal } from '../../lib/types';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Correct a historical (exited) trade. Only mounted when history editing is
 * enabled via VITE_ALLOW_HISTORY_EDIT — this is a data-fix tool, not everyday UI.
 * Edits exit values + entry basis; P&L/R recompute server-side on save.
 */
export function EditHistoryForm({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [entryPrice, setEntryPrice] = useState(String(trade.entryPrice));
  const [slPrice, setSlPrice] = useState(String(trade.slPrice));
  const [upeti, setUpeti] = useState(String(trade.upeti));
  const [fillPrice, setFillPrice] = useState(trade.fillPrice != null ? String(trade.fillPrice) : '');
  const [fillShares, setFillShares] = useState(trade.fillShares != null ? String(trade.fillShares) : '');
  const [fillDate, setFillDate] = useState(trade.fillDate ?? '');
  const [exitPrice, setExitPrice] = useState(trade.exitPrice != null ? String(trade.exitPrice) : '');
  const [exitDate, setExitDate] = useState(trade.exitDate ?? '');
  const [entrySignal, setEntrySignal] = useState<EntrySignal>(trade.entrySignal);

  const num = (s: string) => Number(s);
  const posErr = (s: string, label: string) => (s === '' || !(num(s) > 0) ? `${label} must be a positive number` : '');
  const entryErr = posErr(entryPrice, 'Entry price');
  const slErr = posErr(slPrice, 'SL price');
  const upetiErr = posErr(upeti, 'Upet1');
  const fillPriceErr = fillPrice !== '' && !(num(fillPrice) > 0) ? 'Fill price must be positive' : '';
  const fillSharesErr = fillShares !== '' && !(Number.isInteger(num(fillShares)) && num(fillShares) > 0) ? 'Quantity must be a positive whole number' : '';
  const fillDateErr = ISO.test(fillDate) ? '' : 'Fill date is required (YYYY-MM-DD)';
  const exitPriceErr = posErr(exitPrice, 'Exit price');
  const exitDateErr = ISO.test(exitDate) ? '' : 'Exit date is required (YYYY-MM-DD)';

  const valid = !entryErr && !slErr && !upetiErr && !fillPriceErr && !fillSharesErr && !fillDateErr && !exitPriceErr && !exitDateErr;

  const m = useMutation({
    mutationFn: () =>
      api.patch(trade.id, {
        entryPrice: num(entryPrice),
        slPrice: num(slPrice),
        upeti: num(upeti),
        fillPrice: fillPrice === '' ? undefined : num(fillPrice),
        fillShares: fillShares === '' ? null : num(fillShares),
        fillDate,
        exitPrice: num(exitPrice),
        exitDate,
        entrySignal,
      }),
    // Refresh history rows AND the year summary/equity curve, which all derive from P&L.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['years'] });
      toast('Trade updated');
      onClose();
    },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  const inputCls = (err: string) =>
    `mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${err ? 'border-red-500' : 'border-slate-300 dark:border-0'}`;
  const err = (msg: string) => msg && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{msg}</span>;

  return (
    <Modal title={`Correct ${trade.ticker} — history`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="block">Entry price
          <input type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className={inputCls(entryErr)} />
          {err(entryErr)}
        </label>
        <label className="block">SL price
          <input type="number" step="any" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} className={inputCls(slErr)} />
          {err(slErr)}
        </label>
        <label className="block">Upet1
          <input type="number" step="any" value={upeti} onChange={(e) => setUpeti(e.target.value)} className={inputCls(upetiErr)} />
          {err(upetiErr)}
        </label>
        <label className="block">Entry signal
          <select value={entrySignal} onChange={(e) => setEntrySignal(e.target.value as EntrySignal)} className={inputCls('')}>
            {SIGNALS_BY_DIRECTION[trade.direction].map((s) => <option key={s} value={s}>{SIGNAL_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="block">Fill price
          <input type="number" step="any" value={fillPrice} onChange={(e) => setFillPrice(e.target.value)} className={inputCls(fillPriceErr)} placeholder={String(trade.entryPrice)} />
          {err(fillPriceErr)}
        </label>
        <label className="block">Quantity
          <input type="number" step="1" min="1" value={fillShares} onChange={(e) => setFillShares(e.target.value)} className={inputCls(fillSharesErr)} placeholder={`${trade.shares} (computed)`} />
          {err(fillSharesErr)}
        </label>
        <label className="block">Fill date
          <input type="date" value={fillDate} onChange={(e) => setFillDate(e.target.value)} className={inputCls(fillDateErr)} />
          {err(fillDateErr)}
        </label>
        <label className="block">Exit price
          <input type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} className={inputCls(exitPriceErr)} />
          {err(exitPriceErr)}
        </label>
        <label className="block">Exit date
          <input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} className={inputCls(exitDateErr)} />
          {err(exitDateErr)}
        </label>
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Leave Fill price / Quantity blank to keep the computed size. P&amp;L and R recalculate on save.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="cursor-pointer rounded bg-slate-300 px-3 py-1 text-slate-900 dark:bg-slate-600 dark:text-slate-100">Cancel</button>
        <button disabled={!valid || m.isPending} onClick={() => m.mutate()} className="cursor-pointer rounded bg-emerald-600 px-3 py-1 text-white disabled:cursor-not-allowed disabled:opacity-50">Save</button>
      </div>
    </Modal>
  );
}
