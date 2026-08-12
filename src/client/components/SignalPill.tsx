import type { EntrySignal } from '../../lib/types';

export const SIGNAL_LABELS: Record<EntrySignal, string> = {
  btb: 'BTB', buy_lautan: 'Buy Lautan', buy_magenta: 'Buy Magenta', hawk1: 'Hawk1', buy_spec: 'Buy Spec', no_signal: 'No Signal',
};

// green / light blue / magenta / dark green / pink / gray
export const SIGNAL_CLASSES: Record<EntrySignal, string> = {
  btb: 'bg-teal-500 text-neutral-50 dark:text-neutral-50 ring-teal-500',
  buy_lautan: 'bg-cyan-200 text-sky-800 dark:text-sky-800 ring-cyan-300',
  buy_magenta: 'bg-fuchsia-200 text-fuchsia-800 dark:text-fuchsia-800 ring-fuchsia-300',
  hawk1: 'bg-green-700 text-neutral-50 dark:text-neutral-200 ring-green-800',
  buy_spec: 'bg-cyan-50 text-neutral-500 dark:text-neutral-500 ring-cyan-100',
  no_signal: 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 ring-slate-200',
};

export function SignalPill({ signal }: { signal: EntrySignal }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${SIGNAL_CLASSES[signal]}`}>
      {SIGNAL_LABELS[signal]}
    </span>
  );
}
