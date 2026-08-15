import { Modal } from './ExitForm';
import { SignalPill } from './SignalPill';
import { formatDate } from '../format';
import type { TradeDTO, EntryType, TradeDirection } from '../../lib/types';
import type { ReactNode } from 'react';

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  buy_limit: 'Buy Limit', buy_stop: 'Buy Stop', sell_limit: 'Sell Limit', sell_stop: 'Sell Stop',
};
export const DIRECTION_LABELS: Record<TradeDirection, string> = { long: 'Long', short: 'Short' };

// Optional ticker link templates, e.g. "https://.../?symbol=${TICKER}". Each configured
// template becomes an outbound link in the details modal (in list order); none → no links.
const TICKER_LINKS: { label: string; site: string; template: string }[] = [
  { label: 'T1MO', site: 'T1MO', template: import.meta.env.VITE_T1MO_URL_TEMPLATE ?? '' },
  { label: 'TradingView', site: 'TradingView', template: import.meta.env.VITE_TRADING_VIEW_URL_TEMPLATE ?? '' },
  { label: 'Yahoo Finance', site: 'Yahoo Finance', template: import.meta.env.VITE_YAHOO_FINANCE_URL_TEMPLATE ?? '' },
].filter((l) => l.template);

function tickerLinks(ticker: string): { label: string; site: string; url: string }[] {
  const sym = encodeURIComponent(ticker.toUpperCase());
  return TICKER_LINKS.map((l) => ({ label: l.label, site: l.site, url: l.template.replace(/\{\{TICKER\}\}/g, sym) }));
}

/** One label/value cell in the details grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{children}</div>
    </div>
  );
}

/** Section heading above a group of fields. */
function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{children}</h3>;
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
  const links = tickerLinks(trade.ticker);
  return (
    <Modal title={`${trade.ticker} — trade details`} onClose={onClose} size="xl">
      {links.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {links.map(({ label, site, url }) => (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-slate-200 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-sky-300 dark:hover:bg-slate-600"
              title={`Open ${trade.ticker} on ${site}`}
            >
              {label} ↗
            </a>
          ))}
        </div>
      )}
      {/* Initial trading plan — the parameters set when the plan was created. */}
      <section className="mb-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <SectionTitle>Trading Plan</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          {/* Row 1 */}
          <Field label="Direction">{DIRECTION_LABELS[trade.direction]}</Field>
          <Field label="Entry type">{ENTRY_TYPE_LABELS[trade.entryType]}</Field>
          <Field label="Entry signal"><SignalPill signal={trade.entrySignal} /></Field>
          <div className="hidden sm:block" />
          {/* Row 2 */}
          <Field label="Entry price">{money(trade.entryPrice)}</Field>
          <Field label="SL"><span className="text-red-600 dark:text-red-400">{money(trade.slPrice)}</span></Field>
          <Field label="TP"><span className="text-green-600 dark:text-green-400">{money(trade.tpPrice)}</span></Field>
          <Field label="Risk / Reward">{rr != null ? `1 : ${rr.toFixed(2)}` : '—'}</Field>
          {/* Row 3 */}
          <Field label="Upet1">{money(trade.upeti)}</Field>
          <Field label="QTY">{String(trade.shares)}</Field>
          <Field label="Earnings date">{trade.earningsDate ? formatDate(trade.earningsDate) : '—'}</Field>
        </div>
      </section>

      {/* Execution & outcome — how the plan actually played out. */}
      <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <SectionTitle>Execution &amp; Outcome</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Field label="Status">{STATUS_LABEL[trade.status]}</Field>
          <Field label="Fill">
            <div>{money(trade.fillPrice)}</div>
            {trade.fillDate && <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400">{formatDate(trade.fillDate)}</div>}
          </Field>
          <Field label="Exit">
            <div>{money(trade.exitPrice)}</div>
            {trade.exitDate && <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400">{formatDate(trade.exitDate)}</div>}
          </Field>
          <Field label="Realized P&L">
            {trade.realizedPnl == null ? pnl : (
              <span className={trade.realizedPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{pnl}</span>
            )}
          </Field>
        </div>
      </section>

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
