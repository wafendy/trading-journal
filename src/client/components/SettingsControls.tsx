import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from './Toast';

const VERIFY = [5, 10, 15, 20, 25];

export function SettingsControls() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [upeti, setUpeti] = useState('');
  useEffect(() => { if (settings.data) setUpeti(String(settings.data.upeti)); }, [settings.data]);

  const save = useMutation({
    mutationFn: (b: { upeti?: number; verifyDays?: number }) => api.updateSettings(b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (err: Error) => toast(err.message ?? 'Could not save settings', 'error'),
  });

  const input = 'w-24 rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-0 px-2 py-1 text-sm';
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
      <label className="flex items-center gap-1">Upet1 $
        <input type="number" step="any" value={upeti} onChange={(e) => setUpeti(e.target.value)}
          onBlur={() => { const v = Number(upeti); if (v > 0 && v !== settings.data?.upeti) save.mutate({ upeti: v }); }}
          className={input} />
      </label>
      <label className="flex items-center gap-1">Confirm in
        <select value={settings.data?.verifyDays ?? 15} onChange={(e) => save.mutate({ verifyDays: Number(e.target.value) })}
          className={input}>
          {VERIFY.map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </label>
    </div>
  );
}
