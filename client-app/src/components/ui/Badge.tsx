import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'ok' | 'warn' | 'accent' | 'brand' | 'muted' | 'urgent';

const TONES: Record<BadgeTone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  accent: 'bg-accent-soft text-accent',
  brand: 'bg-brand-soft text-brand',
  muted: 'bg-surface-2 text-muted',
  urgent: 'bg-urgent-soft text-urgent',
};

interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'muted', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Distintivo de urgencias 24h: el único elemento que usa el rojo de marca. */
export function UrgentBadge({ className }: { className?: string }) {
  return (
    <Badge
      tone="urgent"
      className={className}
      icon={
        <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden="true">
          <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" />
        </svg>
      }
    >
      Urgencias 24h
    </Badge>
  );
}

export function OpenBadge({ openNow, label }: { openNow: boolean; label: string }) {
  return (
    <Badge tone={openNow ? 'ok' : 'muted'}>
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', openNow ? 'bg-ok' : 'bg-line-strong')}
      />
      {label}
    </Badge>
  );
}
