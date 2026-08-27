import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-2', className)} />;
}

export function ShopCardSkeleton() {
  return (
    <div className="space-y-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? <div className="text-line-strong">{icon}</div> : null}
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-urgent/25 bg-urgent-soft px-4 py-3">
      <svg viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0 text-urgent" fill="currentColor">
        <path d="M12 2l10 18H2zM11 9h2v5h-2zm0 6h2v2h-2z" />
      </svg>
      <div className="flex-1 text-sm text-urgent-strong">{message}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-sm font-semibold text-urgent underline underline-offset-2"
        >
          Reintentar
        </button>
      ) : null}
    </div>
  );
}
