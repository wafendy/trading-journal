import { useEffect, useRef, useState } from 'react';
import { Check, X, Save, Pencil, LogOut } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { SignalPill } from './SignalPill';
import { ExitForm, Modal } from './ExitForm';
import { FillModal } from './FillModal';
import { EditPositionForm } from './EditPositionForm';
import { EditPlanForm } from './EditPlanForm';
import { TradeDetails, NoteIcon } from './TradeDetails';
import { useToast } from './Toast';
import { computePnl } from '../../lib/calc';
import { formatDate } from '../format';
import { T1moLink } from './T1moLink';
import type { TradeDTO } from '../../lib/types';

// Live-price cache, keyed by ticker. Module-level so it survives tab remounts.
// TTL configurable via VITE_PRICE_CACHE_MINUTES (default 15); refresh serves fresh
// entries from cache instead of hitting the API.
const PRICE_CACHE_MS = (Number(import.meta.env.VITE_PRICE_CACHE_MINUTES) || 15) * 60_000;
const priceCache = new Map<string, { price: number | null; at: number }>();

const todayISO = () => new Date().toISOString().slice(0, 10);
const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);
const th = 'px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400';

const MS_PER_DAY = 86_400_000;
// Whole days from today until an ISO date (negative if already past), or null.
function daysUntil(iso: string | null): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const target = new Date(iso + 'T00:00:00Z').getTime();
  const today = new Date(todayISO() + 'T00:00:00Z').getTime();
  return Math.round((target - today) / MS_PER_DAY);
}
// Whole calendar days since an ISO date up to today (0 if today/future), or null.
function daysSince(iso: string | null): number | null {
  const d = daysUntil(iso);
  return d === null ? null : Math.max(0, -d);
}
// Earnings within the next 7 days (0–7 inclusive, not past) → warn.
function earningsSoon(iso: string | null): number | null {
  const d = daysUntil(iso);
  return d !== null && d >= 0 && d <= 7 ? d : null;
}
const earningsMissing = (iso: string | null) => iso == null || iso === '';

// Countdown to earnings: green >10 days, yellow 5–10, red <5. Hidden once past.
function EarningsCountdown({ iso }: { iso: string }) {
  const d = daysUntil(iso);
  if (d === null || d < 0) return null;
  const color = d > 10
    ? 'text-green-600 dark:text-green-400'
    : d >= 5
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400';
  return <div className={`text-[10px] font-medium ${color}`}>{d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'}`}</div>;
}

function IconButton({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`group relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded ${className ?? ''}`}
    >
      {children}
      <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block dark:bg-slate-700">
        {label}
      </span>
    </button>
  );
}

function Row({ t, children, flagged, warnEarnings, showHeld, livePrice, onOpen }: { t: TradeDTO; children: React.ReactNode; flagged?: boolean; warnEarnings?: boolean; showHeld?: boolean; livePrice?: number | null; onOpen?: (t: TradeDTO) => void }) {
  const held = showHeld ? daysSince(t.fillDate) : null;
  // Estimated unrealized P&L from a manually-fetched live price (not persisted).
  const costBasis = t.fillPrice ?? t.entryPrice;
  const unrealized = livePrice != null ? computePnl(costBasis, livePrice, t.shares, t.direction) : null;
  const soon = warnEarnings ? earningsSoon(t.earningsDate) : null;
  // Yellow earnings warning when the row isn't already flagged red (dud takes precedence).
  const earningsWarn = warnEarnings && !flagged && (soon !== null || earningsMissing(t.earningsDate));
  const rowBg = flagged
    ? 'bg-red-400/40 dark:bg-red-900/80'
    : earningsWarn
      ? 'bg-amber-100 dark:bg-amber-400/50'
      : '';
  const rowTitle = flagged
    ? 'Past verify window — Keep to stop reminding, or Exit'
    : earningsWarn
      ? 'Earnings warning — check the earnings date'
      : undefined;
  return (
    <tr
      onClick={onOpen ? () => onOpen(t) : undefined}
      className={`${rowBg} ${onOpen ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/60' : ''}`}
      title={rowTitle}
    >
      <td className="px-3 py-2 font-medium">
        <T1moLink ticker={t.ticker} />
        {t.ticker}
        {t.direction === 'short' && (
          <span className="ml-1.5 rounded bg-rose-200 px-1 py-0.5 text-[10px] font-semibold text-rose-900 dark:bg-rose-500/30 dark:text-rose-200" title="Short position">SHORT</span>
        )}
        {t.notes && <NoteIcon />}
      </td>
      <td className="px-3 py-2"><SignalPill signal={t.entrySignal} /></td>
      {/* Entry cell folds qty/price + SL/TP (and fill date, for Active) into one column. */}
      <td className="px-3 py-2">
        <div className="leading-tight">
          <div>{t.shares} @ {money(showHeld ? (t.fillPrice ?? t.entryPrice) : t.entryPrice)}</div>
          <div className="text-[11px]">
            <span className="text-red-600 dark:text-red-400">SL: {money(t.slPrice)}</span>
            {t.tpPrice != null && <span className="ml-2 text-green-600 dark:text-green-400">TP: {money(t.tpPrice)}</span>}
          </div>
          {showHeld && t.fillDate && <div className="text-[10px] text-slate-500 dark:text-slate-400">Date filled: {formatDate(t.fillDate)}</div>}
        </div>
      </td>
      {showHeld && (
        <td className="px-3 py-2">
          {unrealized === null ? (
            <span className="text-slate-400 dark:text-slate-500">—</span>
          ) : (
            <div className="leading-tight">
              <div className={`font-semibold ${unrealized >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {money(unrealized)}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">@ {money(livePrice ?? null)}</div>
            </div>
          )}
        </td>
      )}
      <td className="px-3 py-2">
        {t.earningsDate ? (
          <div className="leading-tight">
            <div>{formatDate(t.earningsDate)}</div>
            <EarningsCountdown iso={t.earningsDate} />
          </div>
        ) : (
          <>
            —
            {warnEarnings && (
              <span className="ml-2 rounded bg-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-900 dark:bg-red-500/30 dark:text-red-200" title="No earnings date set">
                ⚠ no date
              </span>
            )}
          </>
        )}
      </td>
      {showHeld && <td className="px-3 py-2">{held === null ? '—' : held}</td>}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>{children}</td>
    </tr>
  );
}

function HeaderRow({ showHeld }: { showHeld?: boolean }) {
  return (
    <thead><tr>
      <th className={th}>Ticker</th><th className={th}>Signal</th><th className={th}>Entry</th>{showHeld && <th className={th}>Unrealized P&L</th>}<th className={th}>Earnings</th>{showHeld && <th className={th}>Held</th>}<th className={th}>Actions</th>
    </tr></thead>
  );
}

export function PendingOrders() {
  const qc = useQueryClient();
  const toast = useToast();
  const pending = useQuery({ queryKey: ['trades', 'pending'], queryFn: () => api.open('pending') });
  const [viewing, setViewing] = useState<TradeDTO | null>(null);
  const [filling, setFilling] = useState<TradeDTO | null>(null);
  const [editing, setEditing] = useState<TradeDTO | null>(null);
  const [cancelling, setCancelling] = useState<TradeDTO | null>(null);
  const inval = () => qc.invalidateQueries();

  const cancel = useMutation({
    mutationFn: (id: number) => api.cancel(id),
    onSuccess: () => { inval(); toast('Pending order cancelled'); setCancelling(null); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  return (
    <section>
      <table className="w-full text-sm">
        <HeaderRow />
        <tbody>
          {pending.data?.map((t) => (
            <Row key={t.id} t={t} onOpen={setViewing}>
              <span className="flex gap-1">
                <IconButton label="Mark filled" onClick={() => setFilling(t)} className="bg-emerald-600 text-white"><Check className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Edit" onClick={() => setEditing(t)} className="bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100"><Pencil className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Cancel" onClick={() => setCancelling(t)} className="bg-red-600 text-white"><X className="h-3.5 w-3.5" /></IconButton>
              </span>
            </Row>
          ))}
          {pending.data?.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-slate-500 dark:text-slate-500">No trading plans yet</td></tr>}
        </tbody>
      </table>
      {viewing && <TradeDetails trade={viewing} onClose={() => setViewing(null)} />}
      {filling && <FillModal trade={filling} onClose={() => setFilling(null)} />}
      {editing && <EditPlanForm trade={editing} onClose={() => setEditing(null)} />}
      {cancelling && (
        <Modal title={`Cancel ${cancelling.ticker} trading plan?`} onClose={() => setCancelling(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">This permanently deletes the trading plan. This cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setCancelling(null)} className="cursor-pointer px-3 py-1 rounded bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100">Keep</button>
            <button disabled={cancel.isPending} onClick={() => cancel.mutate(cancelling.id)} className="cursor-pointer px-3 py-1 rounded bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed">Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function ActivePositions() {
  const qc = useQueryClient();
  const toast = useToast();
  const filled = useQuery({ queryKey: ['trades', 'filled'], queryFn: () => api.open('filled') });
  const [exiting, setExiting] = useState<TradeDTO | null>(null);
  const [editing, setEditing] = useState<TradeDTO | null>(null);
  const [viewing, setViewing] = useState<TradeDTO | null>(null);
  // Manually-fetched live prices, keyed by ticker. In-memory only — never persisted.
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [pricesAt, setPricesAt] = useState<string | null>(null);
  const inval = () => qc.invalidateQueries();

  const keep = useMutation({
    mutationFn: (id: number) => api.dudDecision(id, { decision: 'keep' }),
    onSuccess: () => { inval(); toast('Kept — will stop reminding'); },
    onError: (err: Error) => toast(err.message ?? 'Something went wrong', 'error'),
  });

  // Fetch the current price for each distinct ticker and compute unrealized P&L.
  // Plain async + a `refreshing` flag cleared in `finally` — guaranteed to reset even
  // if calls overlap (a useMutation observer can otherwise leave isPending stuck).
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const refreshPrices = async () => {
    if (refreshingRef.current) return; // ignore overlapping runs
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const tickers = [...new Set((filled.data ?? []).map((t) => t.ticker))];
      const fresh = Date.now() - PRICE_CACHE_MS;
      let fetched = 0; // live API calls actually made this run
      const entries = await Promise.all(
        tickers.map(async (ticker) => {
          const hit = priceCache.get(ticker);
          if (hit && hit.at >= fresh) return [ticker, hit.price] as const; // cached — no API call
          fetched++;
          try {
            const price = (await api.quote(ticker)).price;
            priceCache.set(ticker, { price, at: Date.now() });
            return [ticker, price] as const;
          } catch { return [ticker, hit?.price ?? null] as const; }
        }),
      );
      const result = Object.fromEntries(entries) as Record<string, number | null>;
      setPrices(result);
      setPricesAt(new Date().toLocaleTimeString());
      // Only toast when we actually hit the API; a fully-cached refresh stays silent.
      if (fetched > 0) {
        const missing = Object.values(result).filter((p) => p == null).length;
        if (missing === Object.keys(result).length) {
          toast('No prices returned — is FINNHUB_API_KEY set?', 'error');
        } else if (missing > 0) {
          toast(`Updated; ${missing} ticker(s) had no price`);
        } else {
          toast('Prices updated');
        }
      }
    } catch (err) {
      toast((err as Error)?.message ?? 'Could not fetch prices', 'error');
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  // Auto-refresh prices once when the tab opens, as soon as positions have loaded.
  // ActivePositions remounts each time the tab is activated, so this fires per visit.
  const autoRefreshed = useRef(false);
  const hasPositions = (filled.data?.length ?? 0) > 0;
  useEffect(() => {
    if (autoRefreshed.current || !hasPositions) return;
    autoRefreshed.current = true;
    refreshPrices();
    // Fire once when positions first load; refreshPrices is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPositions]);

  const earningsWarnings = (filled.data ?? [])
    .map((t) => ({ t, days: earningsSoon(t.earningsDate) }))
    .filter((x) => x.days !== null)
    .sort((a, b) => (a.days as number) - (b.days as number));
  const missingEarnings = (filled.data ?? []).filter((t) => earningsMissing(t.earningsDate));

  return (
    <section className="space-y-3">
      {earningsWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-semibold">⚠ Earnings soon:</span>{' '}
          {earningsWarnings
            .map(({ t, days }) => `${t.ticker} (${days === 0 ? 'today' : `${days}d`})`)
            .join(', ')}{' '}
          — consider exiting before the report.
        </div>
      )}
      {missingEarnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-semibold">⚠ Missing earnings date:</span>{' '}
          {missingEarnings.map((t) => t.ticker).join(', ')}{' '}
          — set an earnings date so you can be warned before the report.
        </div>
      )}
      {(filled.data?.length ?? 0) > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => refreshPrices()}
            disabled={refreshing}
            className="cursor-pointer rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? 'Fetching prices…' : 'Refresh prices'}
          </button>
          {pricesAt && <span className="text-xs text-slate-500 dark:text-slate-400">Estimated unrealized P&amp;L as of {pricesAt}</span>}
        </div>
      )}
      <table className="w-full text-sm">
        <HeaderRow showHeld />
        <tbody>
          {filled.data?.map((t) => (
            <Row key={t.id} t={t} flagged={t.dudFlagged} warnEarnings showHeld livePrice={prices[t.ticker]} onOpen={setViewing}>
              <span className="flex items-center gap-1">
                {t.dudFlagged && (
                  <IconButton label="Keep" onClick={() => keep.mutate(t.id)} className="bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100"><Save className="h-3.5 w-3.5" /></IconButton>
                )}
                <IconButton label="Edit" onClick={() => setEditing(t)} className="bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100"><Pencil className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Exit" onClick={() => setExiting(t)} className={`text-white ${t.dudFlagged ? 'bg-red-600' : 'bg-slate-500 dark:bg-slate-500'}`}><LogOut className="h-3.5 w-3.5" /></IconButton>
              </span>
            </Row>
          ))}
          {filled.data?.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-slate-500 dark:text-slate-500">No active positions</td></tr>}
        </tbody>
      </table>

      {exiting && <ExitForm trade={exiting} onClose={() => setExiting(null)} />}
      {editing && <EditPositionForm trade={editing} onClose={() => setEditing(null)} />}
      {viewing && <TradeDetails trade={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
