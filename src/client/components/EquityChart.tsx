import { useEffect, useRef } from 'react';
import { AreaSeries, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import type { Summary } from '../api';

/**
 * Cumulative Realized P&L equity curve, rendered with TradingView
 * lightweight-charts. The API rejects duplicate/unsorted `time` values, so
 * same-day exits are collapsed to a single point (the running cumulative total
 * for that date — the last value wins since the curve is already ascending).
 */
function toSeriesData(curve: Summary['equityCurve']) {
  const byDate = new Map<string, number>();
  for (const p of curve) byDate.set(p.exitDate, p.cumulativePnl);
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ time: date as Time, value }));
}

const isDark = () => document.documentElement.classList.contains('dark');

export function EquityChart({ data }: { data: Summary['equityCurve'] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const applyTheme = (chart: IChartApi) => {
      const dark = isDark();
      chart.applyOptions({
        layout: {
          background: { color: 'transparent' },
          textColor: dark ? '#94a3b8' : '#475569',
        },
        grid: {
          vertLines: { color: dark ? '#1e293b' : '#e2e8f0' },
          horzLines: { color: dark ? '#1e293b' : '#e2e8f0' },
        },
        rightPriceScale: { borderColor: dark ? '#334155' : '#cbd5e1' },
        timeScale: { borderColor: dark ? '#334155' : '#cbd5e1' },
      });
    };

    const chart = createChart(el, {
      height: 192,
      autoSize: true,
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#10b981',
      topColor: 'rgba(16,185,129,0.4)',
      bottomColor: 'rgba(16,185,129,0.02)',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.createPriceLine({ price: 0, color: '#64748b', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });

    chartRef.current = chart;
    seriesRef.current = series;
    applyTheme(chart);

    // Re-theme when the .dark class on <html> changes.
    const observer = new MutationObserver(() => applyTheme(chart));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Push data whenever it changes.
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    seriesRef.current.setData(toSeriesData(data));
    chartRef.current.timeScale().fitContent();
  }, [data]);

  if (data.length === 0) {
    return <div className="grid h-48 place-items-center text-sm text-slate-500 dark:text-slate-500">No data for this year</div>;
  }
  return <div ref={containerRef} className="h-48 w-full" />;
}
