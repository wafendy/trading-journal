import { Modal } from './ExitForm';
import { SIGNAL_LABELS } from './SignalPill';
import type { TradeDTO } from '../../lib/types';

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

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
  const rows: [string, string][] = [
    ['Ticker', trade.ticker],
    ['Status', STATUS_LABEL[trade.status]],
    ['Entry signal', SIGNAL_LABELS[trade.entrySignal]],
    ['Entry type', trade.entryType === 'buy_limit' ? 'Buy Limit' : 'Buy Stop'],
    ['Entry', `${money(trade.entryPrice)}  (${trade.entryDate})`],
    ['SL / TP', `${money(trade.slPrice)} / ${money(trade.tpPrice)}`],
    ['Shares', String(trade.shares)],
    ['Earnings', trade.earningsDate ?? '—'],
  ];
  if (trade.status === 'exited') {
    rows.push(['Exit', `${money(trade.exitPrice)}  (${trade.exitDate ?? '—'})`]);
    rows.push([
      'Realized P&L',
      `${money(trade.realizedPnl)}${trade.rMultiple != null ? `  (${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R)` : ''}`,
    ]);
  }
  return (
    <Modal title={`${trade.ticker} — trade details`} onClose={onClose}>
      <div className="space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">{k}</span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{v}</span>
          </div>
        ))}
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
