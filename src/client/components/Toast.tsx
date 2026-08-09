import { createContext, useCallback, useContext, useRef, useState } from 'react';

type Kind = 'success' | 'error';
interface ToastItem {
  id: number;
  message: string;
  kind: Kind;
}

const ToastCtx = createContext<(message: string, kind?: Kind) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((message: string, kind: Kind = 'success') => {
    const id = nextId.current++;
    setItems((s) => [...s, { id, message, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-2 text-sm shadow-lg ring-1 ${
              t.kind === 'success'
                ? 'bg-green-100 text-green-800 ring-green-300 dark:bg-green-900/40 dark:text-green-200 dark:ring-green-700'
                : 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-900/40 dark:text-red-200 dark:ring-red-700'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
