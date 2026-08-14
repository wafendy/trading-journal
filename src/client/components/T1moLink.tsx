import { LineChart } from 'lucide-react';

// T1mo chart shortcut shown before the ticker. Hidden if the template env var is unset.
const TEMPLATE = import.meta.env.VITE_T1MO_URL_TEMPLATE ?? '';

export function T1moLink({ ticker }: { ticker: string }) {
  if (!TEMPLATE) return null;
  const url = TEMPLATE.replace(/\{\{TICKER\}\}/g, encodeURIComponent(ticker.toUpperCase()));
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in T1mo"
      aria-label="Open in T1mo"
      onClick={(e) => e.stopPropagation()} // don't trigger the row's open-details click
      className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded bg-slate-200 align-[-4px] text-slate-700 hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500"
    >
      <LineChart className="h-3 w-3" />
    </a>
  );
}
