import { useState } from 'react';
import { api } from '../api';
import { Modal } from './ExitForm';
import { useToast } from './Toast';
import type { TradeDTO } from '../../lib/types';

const MAX_BYTES = 10 * 1024 * 1024;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** View, upload/paste, and remove the single chart screenshot for a trade. */
export function ChartModal({ trade, onClose }: { trade: TradeDTO; onClose: () => void }) {
  const toast = useToast();
  // Bumped after upload/remove to force the <img> to refetch (responses are no-store).
  const [version, setVersion] = useState(1);
  const [hasImage, setHasImage] = useState(true); // assume present; onError flips to placeholder
  const [busy, setBusy] = useState(false);

  const doUpload = async (file: File) => {
    if (!OK_TYPES.includes(file.type)) { toast('Only PNG, JPEG or WebP images are allowed', 'error'); return; }
    if (file.size > MAX_BYTES) { toast('Image exceeds 10MB', 'error'); return; }
    setBusy(true);
    try {
      await api.uploadScreenshot(trade.id, file);
      setHasImage(true);
      setVersion((v) => v + 1);
      toast('Chart updated');
    } catch (err) {
      toast((err as Error)?.message ?? 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files)[0];
    if (file) { e.preventDefault(); doUpload(file); }
  };

  const doRemove = async () => {
    setBusy(true);
    try {
      await api.deleteScreenshot(trade.id);
      setHasImage(false);
      setVersion((v) => v + 1);
      toast('Chart removed');
    } catch (err) {
      toast((err as Error)?.message ?? 'Remove failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${trade.ticker} — chart`} onClose={onClose} size="xl">
      <div
        onPaste={onPaste}
        className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600"
        tabIndex={0}
      >
        {hasImage ? (
          <img
            src={api.screenshotUrl(trade.id, version)}
            alt={`${trade.ticker} chart`}
            className="mx-auto max-h-[60vh] w-auto rounded"
            onError={() => setHasImage(false)}
          />
        ) : (
          <div className="grid h-40 place-items-center text-sm text-slate-500 dark:text-slate-400">
            No chart attached — choose a file or paste an image (Cmd+V) here.
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <label className="cursor-pointer rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white">
          {busy ? 'Working…' : hasImage ? 'Replace image' : 'Choose image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ''; }}
          />
        </label>
        <div className="flex gap-2">
          {hasImage && (
            <button onClick={doRemove} disabled={busy} className="cursor-pointer rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Remove</button>
          )}
          <button onClick={onClose} className="cursor-pointer rounded bg-slate-300 px-3 py-1.5 text-sm text-slate-900 dark:bg-slate-600 dark:text-slate-100">Close</button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Images are converted to WebP automatically. Max 10MB.</p>
    </Modal>
  );
}
