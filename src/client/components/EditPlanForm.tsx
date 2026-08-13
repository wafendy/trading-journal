import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Modal } from './ExitForm';
import { useToast } from './Toast';
import { SIGNAL_LABELS, SIGNALS_BY_DIRECTION } from './SignalPill';
import type { TradeDTO, EntrySignal } from '../../lib/types';

/** Edit a pending trading plan: SL, TP, earnings, and entry signal. */
export function EditPlanForm({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [slPrice, setSlPrice] = useState(String(trade.slPrice));
  const [tpPrice, setTpPrice] = useState(trade.tpPrice != null ? String(trade.tpPrice) : '');
  const [earningsDate, setEarningsDate] = useState(trade.earningsDate ?? '');
  const [entrySignal, setEntrySignal] = useState<EntrySignal>(trade.entrySignal);

  const entry = trade.entryPrice;
  const short = trade.direction === 'short';
  const s = Number(slPrice), tp = Number(tpPrice);
  // SL/TP sit on opposite sides of entry for shorts (SL above, TP below).
  const slError = slPrice === '' || !(s > 0)
    ? 'SL is required'
    : (short ? s <= entry : s >= entry)
      ? (short ? 'SL must be above entry price' : 'SL must be below entry price') : '';
  const tpError = tpPrice !== '' && (short ? tp > entry : tp < entry)
    ? (short ? 'TP must be at or below entry price' : 'TP must be at or above entry price') : '';

  const m = useMutation({
    mutationFn: () =>
      api.patch(trade.id, {
        slPrice: Number(slPrice),
        tpPrice: tpPrice === '' ? null : Number(tpPrice),
        earningsDate: earningsDate === '' ? null : earningsDate,
        entrySignal,
      }),
    onSuccess: () => { qc.invalidateQueries(); toast('Plan updated'); onClose(); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  const valid = !slError && !tpError;
  const inputCls = (err: string) =>
    `mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${err ? 'border-red-500' : 'border-slate-300 dark:border-0'}`;

  return (
    <Modal title={`Edit ${trade.ticker} plan — entry ${trade.entryPrice}`} onClose={onClose} size="lg">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <label className="block">SL price
          <input type="number" step="any" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} className={inputCls(slError)} />
          {slError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{slError}</span>}
        </label>
        <label className="block">TP price (optional)
          <input type="number" step="any" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} className={inputCls(tpError)} />
          {tpError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{tpError}</span>}
        </label>
        <label className="block">Earnings date
          <input type="date" value={earningsDate} onChange={(e) => setEarningsDate(e.target.value)} className={inputCls('')} />
        </label>
        <label className="block">Entry signal
          <select value={entrySignal} onChange={(e) => setEntrySignal(e.target.value as EntrySignal)} className={inputCls('')}>
            {SIGNALS_BY_DIRECTION[trade.direction].map((sig) => <option key={sig} value={sig}>{SIGNAL_LABELS[sig]}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="cursor-pointer rounded bg-slate-300 px-3 py-1 text-slate-900 dark:bg-slate-600 dark:text-slate-100">Cancel</button>
        <button disabled={!valid || m.isPending} onClick={() => m.mutate()} className="cursor-pointer rounded bg-emerald-600 px-3 py-1 text-white disabled:cursor-not-allowed disabled:opacity-50">Save</button>
      </div>
    </Modal>
  );
}
