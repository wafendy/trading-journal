import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Modal } from './ExitForm';
import { useToast } from './Toast';
import type { TradeDTO } from '../../lib/types';

/** Edit an active position's fill price/qty, SL, TP and earnings date. */
export function EditPositionForm({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [slPrice, setSlPrice] = useState(String(trade.slPrice));
  const [tpPrice, setTpPrice] = useState(trade.tpPrice != null ? String(trade.tpPrice) : '');
  const [earningsDate, setEarningsDate] = useState(trade.earningsDate ?? '');
  const [fillPrice, setFillPrice] = useState(trade.fillPrice != null ? String(trade.fillPrice) : '');
  const [fillShares, setFillShares] = useState(trade.fillShares != null ? String(trade.fillShares) : '');

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
  const fillPriceError = fillPrice !== '' && !(Number(fillPrice) > 0) ? 'Fill price must be positive' : '';
  const fillSharesError = fillShares !== '' && !(Number.isInteger(Number(fillShares)) && Number(fillShares) > 0) ? 'Quantity must be a positive whole number' : '';

  const m = useMutation({
    mutationFn: () =>
      api.patch(trade.id, {
        slPrice: Number(slPrice),
        tpPrice: tpPrice === '' ? null : Number(tpPrice),
        earningsDate: earningsDate === '' ? null : earningsDate,
        fillPrice: fillPrice === '' ? undefined : Number(fillPrice),
        fillShares: fillShares === '' ? null : Number(fillShares),
      }),
    onSuccess: () => { qc.invalidateQueries(); toast('Position updated'); onClose(); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  const valid = !slError && !tpError && !fillPriceError && !fillSharesError;
  const inputCls = (err: string) =>
    `mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${err ? 'border-red-500' : 'border-slate-300 dark:border-0'}`;

  return (
    <Modal title={`Edit ${trade.ticker} — entry ${trade.entryPrice}`} onClose={onClose} size="lg">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <label className="block">Filled price
          <input type="number" step="any" value={fillPrice} onChange={(e) => setFillPrice(e.target.value)} className={inputCls(fillPriceError)} placeholder={String(trade.entryPrice)} />
          {fillPriceError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{fillPriceError}</span>}
        </label>
        <label className="block">QTY
          <input type="number" step="1" min="1" value={fillShares} onChange={(e) => setFillShares(e.target.value)} className={inputCls(fillSharesError)} placeholder={`${trade.shares} (computed)`} />
          {fillSharesError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{fillSharesError}</span>}
        </label>
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
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="cursor-pointer rounded bg-slate-300 px-3 py-1 text-slate-900 dark:bg-slate-600 dark:text-slate-100">Cancel</button>
        <button disabled={!valid || m.isPending} onClick={() => m.mutate()} className="cursor-pointer rounded bg-emerald-600 px-3 py-1 text-white disabled:cursor-not-allowed disabled:opacity-50">Save</button>
      </div>
    </Modal>
  );
}
