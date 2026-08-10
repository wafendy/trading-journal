import { Modal } from './ExitForm';
import { SignalPill } from './SignalPill';
import type { TradeDTO } from '../../lib/types';
import type { ReactNode } from 'react';

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

/** One label/value cell in the details grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{children}</div>
    </div>
  );
}

/** Inline "has notes" indicator — a small document-with-lines glyph. */
export function NoteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="ml-1.5 inline-block h-3 w-3 align-[-1px] text-slate-400 dark:text-slate-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Has notes"
    >
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </svg>
  );
}
const STATUS_LABEL: Record<TradeDTO['status'], string> = {
  pending: 'Pending order',
  filled: 'Active position',
  exited: 'Exited',
};

/** Read-only details + notes for any trade, in any state. */
export function TradeDetails({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const { entryPrice, slPrice, tpPrice } = trade;
  // Risk/Reward = (TP − entry) / (entry − SL), when both risk and reward are defined.
  const rr = tpPrice != null && slPrice != null && entryPrice > slPrice && tpPrice >= entryPrice
    ? (tpPrice - entryPrice) / (entryPrice - slPrice)
    : null;
  const pnl = trade.realizedPnl != null
    ? `${money(trade.realizedPnl)}${trade.rMultiple != null ? ` (${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R)` : ''}`
    : '—';
  return (
    <Modal title={`${trade.ticker} — trade details`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Field label="Status">{STATUS_LABEL[trade.status]}</Field>
        <div />
        <Field label="Entry signal"><SignalPill signal={trade.entrySignal} /></Field>
        <Field label="Entry type">{trade.entryType === 'buy_limit' ? 'Buy Limit' : 'Buy Stop'}</Field>
        <Field label="Fill price">{money(trade.fillPrice)}</Field>
        <Field label="Fill date">{trade.fillDate ?? '—'}</Field>
        <Field label="SL / TP">{`${money(trade.slPrice)} / ${money(trade.tpPrice)}`}</Field>
        <Field label="Earnings date">{trade.earningsDate ?? '—'}</Field>
        <Field label="Shares">{String(trade.shares)}</Field>
        <Field label="UPETI">{money(trade.upeti)}</Field>
        <Field label="Exit price">{money(trade.exitPrice)}</Field>
        <Field label="Exit date">{trade.exitDate ?? '—'}</Field>
        <Field label="Realized P&L">{pnl}</Field>
        <Field label="Risk / Reward">{rr != null ? `1 : ${rr.toFixed(2)}` : '—'}</Field>
      </div>
      <div className="mt-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</div>
        {trade.notes ? (
          <p className="whitespace-pre-wrap rounded bg-slate-100 p-3 text-sm dark:bg-slate-700/50">{trade.notes}</p>
        ) : (
          <p className="text-sm italic text-slate-500 dark:text-slate-400">No notes recorded for this trade.</p>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="cursor-pointer rounded bg-slate-300 px-3 py-1 text-slate-900 dark:bg-slate-600 dark:text-slate-100">Close</button>
      </div>
    </Modal>
  );
}
