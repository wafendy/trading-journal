import type { EntrySignal } from '../../lib/types';

export const SIGNAL_LABELS: Record<EntrySignal, string> = {
  btb: 'BTB', buy_lautan: 'Buy Lautan', buy_magenta: 'Buy Magenta', hawk1: 'Hawk1', buy_spec: 'Buy Spec',
};

// green / light blue / magenta / dark green / pink
export const SIGNAL_CLASSES: Record<EntrySignal, string> = {
  btb: 'bg-teal-500 text-neutral-50 dark:text-neutral-50 ring-teal-500',
  buy_lautan: 'bg-sky-400/20 text-sky-700 dark:text-sky-200 ring-sky-400/40',
  buy_magenta: 'bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-200 ring-fuchsia-500/40',
  hawk1: 'bg-green-700 text-neutral-50 dark:text-neutral-200 ring-green-800',
  buy_spec: 'bg-cyan-50 text-neutral-500 dark:text-neutral-500 ring-cyan-100',
};

export function SignalPill({ signal }: { signal: EntrySignal }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${SIGNAL_CLASSES[signal]}`}>
      {SIGNAL_LABELS[signal]}
    </span>
  );
}
