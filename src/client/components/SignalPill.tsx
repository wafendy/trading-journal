import type { EntrySignal, TradeDirection } from '../../lib/types';

// Which entry signals are offered per direction (order = dropdown order).
export const SIGNALS_BY_DIRECTION: Record<TradeDirection, EntrySignal[]> = {
  long: ['no_signal', 'hawk1', 'green_bull', 'btb', 'buy_lautan', 'buy_magenta', 'buy_spec'],
  short: ['no_signal', 'bear_detected', 'red_bear', 'bbb', 'sell_lautan', 'sell_magenta', 'spec_sell'],
};

export const SIGNAL_LABELS: Record<EntrySignal, string> = {
  no_signal: 'No Signal',
  hawk1: 'Hawk1 Detected',
  green_bull: 'Green Bull',
  btb: 'BTB',
  buy_lautan: 'Buy Lautan',
  buy_magenta: 'Buy Magenta', 
  buy_spec: 'Spec Buy',
  bear_detected: 'Bear Detected',
  red_bear: 'Red Bear',
  bbb: 'BBB', 
  sell_lautan: 'Sell Lautan', 
  sell_magenta: 'Sell Magenta', 
  spec_sell: 'Spec Sell', 
};

// buys/bulls in cool/green tones, sells/bears in warm/red tones, neutrals in gray.
export const SIGNAL_CLASSES: Record<EntrySignal, string> = {
  btb: 'bg-teal-500 text-neutral-50 dark:text-neutral-50 ring-teal-500',
  buy_lautan: 'bg-cyan-200 text-sky-800 dark:text-sky-800 ring-cyan-300',
  buy_magenta: 'bg-fuchsia-200 text-fuchsia-800 dark:text-fuchsia-800 ring-fuchsia-300',
  green_bull: 'bg-emerald-600 text-neutral-50 dark:text-neutral-50 ring-emerald-600',
  hawk1: 'bg-emerald-800 text-neutral-50 dark:text-neutral-200 ring-green-900',
  buy_spec: 'bg-cyan-50 text-neutral-500 dark:text-neutral-500 ring-cyan-100',
  no_signal: 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 ring-slate-200',
  bbb: 'bg-red-500 text-neutral-50 dark:text-neutral-50 ring-red-600',
  sell_lautan: 'bg-red-400 text-neutral-50 dark:text-neutral-50 ring-red-500',
  sell_magenta: 'bg-rose-200 text-rose-800 dark:text-rose-800 ring-rose-300',
  spec_sell: 'bg-red-50 text-neutral-500 dark:text-neutral-500 ring-red-100',
  red_bear: 'bg-red-600 text-neutral-50 dark:text-neutral-50 ring-red-600',
  bear_detected: 'bg-red-900 text-neutral-50 dark:text-neutral-50 ring-red-950',
};

export function SignalPill({ signal }: { signal: EntrySignal }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${SIGNAL_CLASSES[signal]}`}>
      {SIGNAL_LABELS[signal]}
    </span>
  );
}
