import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { ChevronLeftIcon } from '@/components/ui/Icons';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Cabecera pegajosa para las pantallas interiores. */
export function PageHeader({
  title,
  subtitle,
  back = false,
  action,
  children,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-line bg-surface/95 px-4 pt-3 pb-3 backdrop-blur',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {back ? (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Volver"
            className="-ml-1.5 grid size-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] leading-tight font-semibold text-ink">{title}</h1>
          {subtitle ? <p className="truncate text-[13px] text-muted">{subtitle}</p> : null}
        </div>

        {action}
      </div>
      {children}
    </header>
  );
}
