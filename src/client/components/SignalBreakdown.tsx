import type { SignalPerformance } from '../api';
import { SignalPill } from './SignalPill';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pnlCls = (n: number) =>
  n > 0 ? 'text-green-600 dark:text-green-400' : n < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200';

const th = 'px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400';
const td = 'px-3 py-2';

export function SignalBreakdown({ rows }: { rows: SignalPerformance[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800/40">
      <h3 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">By buy signal</h3>
      <table className="w-full text-sm">
        <thead><tr>
          <th className={th}>Signal</th>
          <th className={`${th} text-right`}>P&amp;L</th>
          <th className={`${th} text-right`}>Total R</th>
          <th className={`${th} text-right`}>Trades</th>
          <th className={`${th} text-right`}>Win rate</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.signal} className="border-t border-slate-200 dark:border-slate-700/60">
              <td className={td}><SignalPill signal={r.signal} /></td>
              <td className={`${td} text-right font-medium ${pnlCls(r.pnl)}`}>{money(r.pnl)}</td>
              <td className={`${td} text-right`}>{`${r.totalR >= 0 ? '+' : ''}${r.totalR.toFixed(2)}R`}</td>
              <td className={`${td} text-right`}>{r.tradeCount}</td>
              <td className={`${td} text-right`}>{`${(r.winRate * 100).toFixed(0)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
