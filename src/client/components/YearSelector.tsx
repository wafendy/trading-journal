export function YearSelector({ years, selected, onSelect }: { years: number[]; selected: number | null; onSelect: (y: number) => void }) {
  if (years.length === 0) return <span className="text-slate-500 dark:text-slate-400 text-sm">No exited trades yet</span>;
  return (
    <div className="inline-flex rounded-lg bg-slate-200 dark:bg-slate-800 p-1">
      {years.map((y) => (
        <button key={y} onClick={() => onSelect(y)}
          className={`cursor-pointer px-3 py-1 text-sm rounded-md ${y === selected ? 'bg-white text-slate-900 dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'}`}>
          {y}
        </button>
      ))}
    </div>
  );
}
