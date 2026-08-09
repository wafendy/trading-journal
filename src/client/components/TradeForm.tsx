import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { computeShares } from '../../lib/calc';
import { SIGNAL_LABELS } from './SignalPill';
import type { EntrySignal, EntryType } from '../../lib/types';
import { Modal } from './ExitForm';
import { useToast } from './Toast';

const todayISO = () => new Date().toISOString().slice(0, 10);

// Roll a past ISO date forward in 90-day steps until it is today or later
// (quarterly-earnings cadence). Returns the input unchanged if already future.
function rollForward90(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const today = todayISO();
  if (iso >= today) return iso;
  const d = new Date(iso + 'T00:00:00Z');
  let guard = 0;
  while (d.toISOString().slice(0, 10) < today && guard < 40) {
    d.setUTCDate(d.getUTCDate() + 90);
    guard++;
  }
  return d.toISOString().slice(0, 10);
}
const SIGNALS = Object.keys(SIGNAL_LABELS) as EntrySignal[];

export function TradeForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [ticker, setTicker] = useState('');
  const [upeti, setUpeti] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [tpPrice, setTpPrice] = useState('');
  // Track manual edits so auto-defaults (SL 5% below, TP 10% above entry) only
  // apply while the user hasn't set these fields themselves.
  const [slEdited, setSlEdited] = useState(false);
  const [tpEdited, setTpEdited] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>('buy_limit');
  const [entrySignal, setEntrySignal] = useState<EntrySignal>('buy_lautan');
  const [entryDate, setEntryDate] = useState(todayISO());
  const [earningsDate, setEarningsDate] = useState('');
  const [notes, setNotes] = useState('');
  const [verifyDays, setVerifyDays] = useState(5);

  // Prefill UPETI with the last value entered; default to $100 when none is remembered yet.
  useEffect(() => { if (settings.data) setUpeti(String(settings.data.lastUpeti ?? 100)); }, [settings.data]);

  // Auto-fill SL (5% below) and TP (10% above) from entry price, unless the
  // user has manually edited that field.
  useEffect(() => {
    const ep = Number(entryPrice);
    if (!(ep > 0)) return;
    const round = (n: number) => Math.round(n * 100) / 100;
    if (!slEdited) setSlPrice(String(round(ep * 0.95)));
    if (!tpEdited) setTpPrice(String(round(ep * 1.1)));
  }, [entryPrice, slEdited, tpEdited]);

  const e = Number(entryPrice), s = Number(slPrice), tp = Number(tpPrice), u = Number(upeti);
  const shares = u > 0 && e > s && s > 0 ? computeShares(u, e, s) : 0;

  // Inline field validation
  const slError = slPrice !== '' && e > 0 && s >= e ? 'SL must be below entry price' : '';
  const tpError = tpPrice !== '' && e > 0 && tp < e ? 'TP must be at or above entry price' : '';

  // Risk/Reward ratio = reward per unit of risk = (TP − entry) / (entry − SL)
  const rr = e > s && s > 0 && tpPrice !== '' && tp >= e ? (tp - e) / (e - s) : null;

  const today = todayISO();
  const entryDateError = entryDate !== '' && entryDate < today ? 'Entry date cannot be in the past' : '';
  const earningsDateError = earningsDate !== '' && earningsDate < today ? 'Earnings date cannot be in the past' : '';

  const m = useMutation({
    mutationFn: () => api.create({
      ticker, upeti: Number(upeti), entryPrice: Number(entryPrice), slPrice: Number(slPrice),
      tpPrice: tpPrice ? Number(tpPrice) : null, entryType, entrySignal, entryDate, earningsDate, notes: notes.trim() || null, verifyDays,
    }),
    onSuccess: () => { qc.invalidateQueries(); toast('Trade plan created'); onClose(); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  if (!open) return null;
  const valid = ticker && u > 0 && e > s && s > 0 && earningsDate && !slError && !tpError && !entryDateError && !earningsDateError;
  return (
    <Modal title="New Trade Plan" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Ticker<input value={ticker} onChange={(e) => setTicker(e.target.value)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
        <label>UPETI (risk $)<input type="number" step="any" value={upeti} onChange={(e) => setUpeti(e.target.value)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
        <label>Entry price<input type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
        <label>Entry type<select value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1"><option value="buy_limit">Buy Limit</option><option value="buy_stop">Buy Stop</option></select></label>
        <label>SL price<input type="number" step="any" value={slPrice} onChange={(ev) => { setSlEdited(true); setSlPrice(ev.target.value); }} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${slError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{slError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{slError}</span>}</label>
        <label>TP price (optional)<input type="number" step="any" value={tpPrice} onChange={(ev) => { setTpEdited(true); setTpPrice(ev.target.value); }} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${tpError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{tpError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{tpError}</span>}</label>
        <label>Entry signal<select value={entrySignal} onChange={(e) => setEntrySignal(e.target.value as EntrySignal)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1">{SIGNALS.map((s) => <option key={s} value={s}>{SIGNAL_LABELS[s]}</option>)}</select></label>
        <label>Entry date<input type="date" min={today} value={entryDate} onChange={(ev) => setEntryDate(ev.target.value)} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${entryDateError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{entryDateError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{entryDateError}</span>}</label>
        <label>Earnings date<input type="date" min={today} value={earningsDate} onChange={(ev) => setEarningsDate(rollForward90(ev.target.value))} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${earningsDateError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{earningsDateError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{earningsDateError}</span>}</label>
        <label>Verify in<select value={verifyDays} onChange={(e) => setVerifyDays(Number(e.target.value))} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1">{[5,7,10,14].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
        <label className="col-span-2">Notes (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Thesis, setup, risks…" className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
      </div>
      <div className="mt-3 flex gap-6 text-sm text-slate-600 dark:text-slate-300">
        <div>Position size: <span className="font-semibold text-slate-900 dark:text-slate-100">{shares} shares</span></div>
        <div>Risk/Reward: <span className="font-semibold text-slate-900 dark:text-slate-100">{rr != null ? `1 : ${rr.toFixed(2)}` : '—'}</span></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="cursor-pointer px-3 py-1 rounded bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100">Cancel</button>
        <button disabled={!valid || m.isPending} onClick={() => m.mutate()} className="cursor-pointer px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed">Create plan</button>
      </div>
    </Modal>
  );
}
