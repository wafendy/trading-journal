const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ISO YYYY-MM-DD → DD-MMM-YY (e.g. 2026-09-03 → 03-SEP-26). Non-ISO input passes through.
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  return `${d}-${MONTHS[+mo - 1]}-${y.slice(2)}`;
}
