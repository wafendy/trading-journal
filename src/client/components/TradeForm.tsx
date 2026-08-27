import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { computeShares } from '../../lib/calc';
import { SIGNAL_LABELS, SIGNALS_BY_DIRECTION } from './SignalPill';
import type { EntrySignal, EntryType, TradeDirection } from '../../lib/types';
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
// Order types available per direction — buys for long, sells for short.
const ENTRY_TYPES: Record<TradeDirection, { value: EntryType; label: string }[]> = {
  long: [{ value: 'buy_limit', label: 'Buy Limit' }, { value: 'buy_stop', label: 'Buy Stop' }],
  short: [{ value: 'sell_limit', label: 'Sell Limit' }, { value: 'sell_stop', label: 'Sell Stop' }],
};

export function TradeForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const activePositions = useQuery({ queryKey: ['trades', 'filled'], queryFn: () => api.open('filled') });
  const [ticker, setTicker] = useState('');
  const [upeti, setUpeti] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const entryPriceRef = useRef<HTMLInputElement>(null);
  const [slPrice, setSlPrice] = useState('');
  const [tpPrice, setTpPrice] = useState('');
  // Track manual edits so auto-defaults (SL 5% below, TP 10% above entry) only
  // apply while the user hasn't set these fields themselves.
  const [slEdited, setSlEdited] = useState(false);
  const [tpEdited, setTpEdited] = useState(false);
  const [direction, setDirection] = useState<TradeDirection>('long');
  const [entryType, setEntryType] = useState<EntryType>('buy_stop');
  const [entrySignal, setEntrySignal] = useState<EntrySignal>('buy_lautan');
  const [earningsDate, setEarningsDate] = useState('');
  const [earningsStatus, setEarningsStatus] = useState<'idle' | 'loading' | 'fetched' | 'notfound'>('idle');
  const [earningsEdited, setEarningsEdited] = useState(false);
  const [lastLookedUp, setLastLookedUp] = useState('');

  const lookupEarnings = async () => {
    const t = ticker.trim().toUpperCase();
    if (!t || t === lastLookedUp || earningsEdited) return;
    setLastLookedUp(t);
    setEarningsStatus('loading');
    try {
      const { earningsDate: found } = await api.earnings(t);
      if (found && !earningsEdited) { setEarningsDate(found); setEarningsStatus('fetched'); }
      else setEarningsStatus('notfound');
    } catch { setEarningsStatus('notfound'); }
  };
  const [notes, setNotes] = useState('');

  // Prefill UPETI from the global setting (snapshotted onto the trade at creation).
  useEffect(() => { if (settings.data) setUpeti(String(settings.data.upeti)); }, [settings.data]);

  // Auto-fill SL and TP from entry price, unless the user has edited that field.
  // Long: SL 5% below, TP 10% above. Short: mirrored — SL 5% above, TP 10% below.
  useEffect(() => {
    const ep = Number(entryPrice);
    if (!(ep > 0)) return;
    const round = (n: number) => Math.round(n * 100) / 100;
    const slFactor = direction === 'short' ? 1.05 : 0.95;
    const tpFactor = direction === 'short' ? 0.9 : 1.1;
    if (!slEdited) setSlPrice(String(round(ep * slFactor)));
    if (!tpEdited) setTpPrice(String(round(ep * tpFactor)));
  }, [entryPrice, slEdited, tpEdited, direction]);

  const e = Number(entryPrice), s = Number(slPrice), tp = Number(tpPrice), u = Number(upeti);
  // Per-share risk is on opposite sides of entry by direction.
  const risk = direction === 'short' ? s - e : e - s;
  const shares = u > 0 && risk > 0 && s > 0 ? computeShares(u, e, s, direction) : 0;

  // Inline field validation — SL/TP flip sides for shorts.
  const slError = slPrice !== '' && e > 0 && (direction === 'short' ? s <= e : s >= e)
    ? (direction === 'short' ? 'SL must be above entry price' : 'SL must be below entry price') : '';
  const tpError = tpPrice !== '' && e > 0 && (direction === 'short' ? tp > e : tp < e)
    ? (direction === 'short' ? 'TP must be at or below entry price' : 'TP must be at or above entry price') : '';

  // Risk/Reward ratio = reward per unit of risk. Reward and risk both measured
  // toward the profit/loss side, so the ratio stays positive for either direction.
  const reward = direction === 'short' ? e - tp : tp - e;
  const rr = risk > 0 && s > 0 && tpPrice !== '' && reward >= 0 ? reward / risk : null;

  const today = todayISO();
  const earningsDateError = earningsDate !== '' && earningsDate < today ? 'Earnings date cannot be in the past' : '';
  const tickerActiveWarning = ticker.trim() !== '' && activePositions.data?.some((t) => t.ticker.toUpperCase() === ticker.trim().toUpperCase())
    ? `Existing position in ${ticker.trim().toUpperCase()}` : '';

  // Clear the form back to a pristine state so the next open starts empty.
  // UPETI resets to the current global default (not blank).
  const reset = () => {
    setTicker('');
    setUpeti(String(settings.data?.upeti ?? 100));
    setEntryPrice('');
    setSlPrice('');
    setTpPrice('');
    setSlEdited(false);
    setTpEdited(false);
    setDirection('long');
    setEntryType('buy_stop');
    setEntrySignal('buy_lautan');
    setEarningsDate('');
    setEarningsStatus('idle');
    setEarningsEdited(false);
    setLastLookedUp('');
    setNotes('');
  };

  const m = useMutation({
    mutationFn: () => api.create({
      ticker, upeti: Number(upeti), entryPrice: Number(entryPrice), slPrice: Number(slPrice),
      tpPrice: tpPrice ? Number(tpPrice) : null, entryType, entrySignal, direction, earningsDate, notes: notes.trim() || null, verifyDays: settings.data?.verifyDays ?? 15,
    }),
    onSuccess: () => { qc.invalidateQueries(); toast('Trade plan created'); reset(); onClose(); onCreated?.(); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  if (!open) return null;
  const valid = ticker && u > 0 && risk > 0 && s > 0 && earningsDate && !slError && !tpError && !earningsDateError;
  return (
    <Modal title="New Trade Plan" onClose={onClose}>
      <div className="grid grid-cols-3 gap-3 text-sm">
        {/* Row 1 */}
        <label>Ticker<input value={ticker} onChange={(e) => setTicker(e.target.value)} onBlur={lookupEarnings} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookupEarnings(); entryPriceRef.current?.focus(); } }} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" />{tickerActiveWarning && <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">{tickerActiveWarning}</span>}</label>
        <label>Earnings date<input type="date" min={today} value={earningsDate} onChange={(ev) => { setEarningsEdited(true); setEarningsStatus('idle'); setEarningsDate(rollForward90(ev.target.value)); }} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${earningsDateError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{earningsDateError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{earningsDateError}</span>}{!earningsDateError && earningsStatus === 'loading' && <span className="mt-1 block text-xs text-slate-400">Looking up earnings…</span>}{!earningsDateError && earningsStatus === 'fetched' && <span className="mt-1 block text-xs text-slate-400">Fetched from Finnhub</span>}{!earningsDateError && earningsStatus === 'notfound' && <span className="mt-1 block text-xs text-slate-400">No earnings date found — enter manually</span>}</label>
        <label>Upet1<input type="number" step="any" value={upeti} onChange={(e) => setUpeti(e.target.value)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
        {/* Row 2 */}
        <label>Direction<select value={direction} onChange={(e) => {
          const d = e.target.value as TradeDirection;
          setDirection(d);
          setEntryType(d === 'long' ? 'buy_stop' : ENTRY_TYPES[d][0]!.value); // keep entry type valid for the new direction
          setEntrySignal(SIGNALS_BY_DIRECTION[d][0]!); // and reset signal to a valid one
        }} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1"><option value="long">Long (Buy)</option><option value="short">Short (Sell)</option></select></label>
        <label>Entry signal<select value={entrySignal} onChange={(e) => setEntrySignal(e.target.value as EntrySignal)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1">{SIGNALS_BY_DIRECTION[direction].map((s) => <option key={s} value={s}>{SIGNAL_LABELS[s]}</option>)}</select></label>
        <label>Entry type<select value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1">{ENTRY_TYPES[direction].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        {/* Row 3 */}
        <label>Entry price<input ref={entryPriceRef} type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
        <label>SL price<input type="number" step="any" value={slPrice} onChange={(ev) => { setSlEdited(true); setSlPrice(ev.target.value); }} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${slError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{slError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{slError}</span>}</label>
        <label>TP price (optional)<input type="number" step="any" value={tpPrice} onChange={(ev) => { setTpEdited(true); setTpPrice(ev.target.value); }} className={`mt-1 w-full rounded bg-white dark:bg-slate-700 border px-2 py-1 ${tpError ? 'border-red-500' : 'border-slate-300 dark:border-0'}`} />{tpError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{tpError}</span>}</label>
        {/* Notes */}
        <label className="col-span-3">Notes (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Thesis, setup, risks…" className="mt-1 w-full rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1" /></label>
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
