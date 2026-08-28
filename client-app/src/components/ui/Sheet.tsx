import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  tone?: 'default' | 'urgent';
}

/** Panel inferior deslizante: el patrón de modal de las apps móviles. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  tone = 'default',
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="animate-fade-in absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'animate-sheet-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface',
          'rounded-t-3xl sm:max-w-md sm:rounded-3xl',
        )}
      >
        <header
          className={cn(
            'flex items-start gap-3 border-b border-line px-5 pt-4 pb-3',
            tone === 'urgent' && 'bg-urgent-soft',
          )}
        >
          <div className="min-w-0 flex-1">
            <h2
              className={cn(
                'text-[17px] leading-tight font-semibold',
                tone === 'urgent' ? 'text-urgent-strong' : 'text-ink',
              )}
            >
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {footer ? (
          <footer className="safe-bottom border-t border-line bg-surface px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
