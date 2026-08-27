import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ToastTone = 'info' | 'success' | 'error' | 'urgent';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  info: 'bg-ink text-white',
  success: 'bg-ok text-white',
  error: 'bg-urgent text-white',
  urgent: 'bg-urgent-strong text-white',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-70 flex flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'animate-fade-in max-w-sm rounded-full px-4 py-2.5 text-center text-sm font-medium shadow-float',
              TONE_STYLES[toast.tone],
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return context;
}
