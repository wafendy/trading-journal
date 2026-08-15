import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { YearSelector } from './components/YearSelector';
import { StatTiles } from './components/StatTiles';
import { EquityChart } from './components/EquityChart';
import { SignalBreakdown } from './components/SignalBreakdown';
import { PendingOrders, ActivePositions } from './components/PlanTables';
import { HistoryTable } from './components/HistoryTable';
import { TradeForm } from './components/TradeForm';
import { ThemeToggle } from './components/ThemeToggle';
import { SettingsControls } from './components/SettingsControls';

type Tab = 'pending' | 'active' | 'history';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function App() {
  const [tab, setTab] = useState<Tab>('active');
  const [formOpen, setFormOpen] = useState(false);

  // Counts for the tab badges (shared query keys — deduped with the tables).
  const pending = useQuery({ queryKey: ['trades', 'pending'], queryFn: () => api.open('pending') });
  const filled = useQuery({ queryKey: ['trades', 'filled'], queryFn: () => api.open('filled') });

  // Year state lives here but is only surfaced inside the History tab.
  const years = useQuery({ queryKey: ['years'], queryFn: api.years });
  const [year, setYear] = useState<number | null>(null);
  // Month-range filter for the Performance stats (1-12, inclusive). fromMonth null = whole year.
  const [fromMonth, setFromMonth] = useState<number | null>(null);
  const [toMonth, setToMonth] = useState<number | null>(null);
  useEffect(() => {
    if (year === null && years.data && years.data.length > 0) setYear(years.data[0]!);
  }, [years.data, year]);
  const summary = useQuery({ queryKey: ['summary', year, fromMonth, toMonth], queryFn: () => api.summary(year!, fromMonth, toMonth), enabled: year !== null });

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'pending', label: 'Trading Plan', count: pending.data?.length },
    { key: 'active', label: 'Active Positions', count: filled.data?.length },
    { key: 'history', label: 'Trading History' },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Trading Journal</h1>
          <div className="flex items-center gap-3">
            <SettingsControls />
            <button onClick={() => setFormOpen(true)} className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">+ New Trade Plan</button>
            <ThemeToggle />
          </div>
        </header>

        {/* Tab bar */}
        <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`cursor-pointer -mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                tab === t.key
                  ? 'border-emerald-600 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {tab === 'pending' && <PendingOrders />}
        {tab === 'active' && <ActivePositions />}
        {tab === 'history' && (
          <div className="space-y-6">
            {year !== null && summary.data && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Performance</h2>
                  <div className="flex items-center gap-2">
                    <select
                      value={fromMonth ?? 0}
                      onChange={(e) => {
                        const v = Number(e.target.value) || null;
                        setFromMonth(v);
                        if (v !== null && toMonth === null) setToMonth(12); // first pick → default To = Dec
                        else if (v !== null && toMonth !== null && toMonth < v) setToMonth(v); // keep range valid
                      }}
                      className="cursor-pointer rounded-lg bg-slate-200 px-2 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <option value={0}>All year</option>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                    {fromMonth !== null && (
                      <>
                        <span className="text-sm text-slate-500 dark:text-slate-400">–</span>
                        <select
                          value={toMonth ?? 12}
                          onChange={(e) => setToMonth(Number(e.target.value))}
                          className="cursor-pointer rounded-lg bg-slate-200 px-2 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          {MONTHS.map((m, i) => <option key={m} value={i + 1} disabled={i + 1 < fromMonth}>{m}</option>)}
                        </select>
                      </>
                    )}
                    <YearSelector years={years.data ?? []} selected={year} onSelect={(y) => { setYear(y); setFromMonth(null); setToMonth(null); }} />
                  </div>
                </div>
                <section className="space-y-4">
                  <StatTiles summary={summary.data} />
                  <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800/40"><EquityChart data={summary.data.equityCurve} /></div>
                  <SignalBreakdown rows={summary.data.bySignal} />
                </section>
              </>
            )}
            <HistoryTable year={year} />
          </div>
        )}

        <TradeForm open={formOpen} onClose={() => setFormOpen(false)} onCreated={() => setTab('pending')} />
      </div>
    </div>
  );
}
