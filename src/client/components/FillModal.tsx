import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { TradeDTO } from '../../lib/types';
import { Modal } from './ExitForm';
import { useToast } from './Toast';

const todayISO = () => new Date().toISOString().slice(0, 10);

export function FillModal({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fillDate, setFillDate] = useState(todayISO());
  const [fillPrice, setFillPrice] = useState(String(trade.entryPrice));
  // Quantity defaults to the planned size (computed floor(upeti/risk)); editable.
  const [fillShares, setFillShares] = useState(String(trade.shares));

  const m = useMutation({
    mutationFn: () => api.fill(trade.id, fillDate, Number(fillPrice), Number(fillShares)),
    onSuccess: () => { qc.invalidateQueries(); toast('Order marked as filled'); onClose(); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  const price = Number(fillPrice);
  const qty = Number(fillShares);
  const qtyValid = Number.isInteger(qty) && qty > 0;
  const valid = fillDate !== '' && price > 0 && qtyValid;
  const input = 'mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1';
  return (
    <Modal title={`Mark ${trade.ticker} filled`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Fill date<input type="date" value={fillDate} onChange={(e) => setFillDate(e.target.value)} className={input} /></label>
        <label>Fill price<input type="number" step="any" value={fillPrice} onChange={(e) => setFillPrice(e.target.value)} className={input} /></label>
        <label>Quantity<input type="number" step="1" min="1" value={fillShares} onChange={(e) => setFillShares(e.target.value)} className={input} /></label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="cursor-pointer px-3 py-1 rounded bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100">Cancel</button>
        <button disabled={!valid || m.isPending} onClick={() => m.mutate()} className="cursor-pointer px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed">Confirm fill</button>
      </div>
    </Modal>
  );
}
