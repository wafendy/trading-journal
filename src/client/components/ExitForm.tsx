import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from './Toast';
import type { TradeDTO } from '../../lib/types';

const todayISO = () => new Date().toISOString().slice(0, 10);

export function ExitForm({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [exitPrice, setExitPrice] = useState('');
  const [exitDate, setExitDate] = useState(todayISO());
  const m = useMutation({
    mutationFn: () => api.exit(trade.id, Number(exitPrice), exitDate),
    onSuccess: () => { qc.invalidateQueries(); toast('Trade exited'); onClose(); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });
  return (
    <Modal onClose={onClose} title={`Exit ${trade.ticker}`}>
      <label className="block text-sm">Exit price
        <input type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" />
      </label>
      <label className="block text-sm mt-3">Exit date
        <input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="cursor-pointer px-3 py-1 rounded bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100">Cancel</button>
        <button disabled={!exitPrice || m.isPending} onClick={() => m.mutate()} className="cursor-pointer px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed">Confirm exit</button>
      </div>
    </Modal>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-5 text-slate-900 dark:text-slate-100" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
