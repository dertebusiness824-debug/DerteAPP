import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { BottomNav } from './BottomNav';

interface AppShellProps {
  header?: ReactNode;
  children: ReactNode;
  /** Las pantallas de detalle ocultan la barra inferior. */
  hideNav?: boolean;
  className?: string;
}

export function AppShell({ header, children, hideNav = false, className }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-page">
      <div className="mx-auto flex min-h-dvh w-full max-w-page flex-col bg-page shadow-[0_0_0_1px_rgba(15,23,42,0.04)]">
        {header}
        <main className={cn('flex-1', hideNav ? 'pb-8' : 'pb-nav', className)}>{children}</main>
      </div>
      {hideNav ? null : <BottomNav />}
    </div>
  );
}

interface SectionProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={cn('px-4 py-4', className)}>
      {title || action ? (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-[15px] font-semibold text-ink">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}
