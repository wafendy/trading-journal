import type { Summary } from '../api';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function StatTiles({ summary }: { summary: Summary }) {
  const pnlColor = summary.totalPnl > 0 ? 'text-green-600 dark:text-green-400' : summary.totalPnl < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200';
  const tiles = [
    { label: 'Realized P&L', value: money(summary.totalPnl), cls: pnlColor },
    { label: 'Total R', value: `${summary.totalR >= 0 ? '+' : ''}${summary.totalR.toFixed(2)}R`, cls: 'text-slate-900 dark:text-slate-100' },
    { label: 'Trades', value: String(summary.tradeCount), cls: 'text-slate-900 dark:text-slate-100' },
    { label: 'Win rate', value: `${(summary.winRate * 100).toFixed(0)}%`, cls: 'text-slate-900 dark:text-slate-100' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.label}</div>
          <div className={`mt-1 text-2xl font-semibold ${t.cls}`}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}
