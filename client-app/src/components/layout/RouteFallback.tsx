import { AppShell, Section } from './AppShell';
import { Skeleton } from '@/components/ui/States';

/** Esqueleto mientras se descarga el trozo de una pantalla. */
export function RouteFallback() {
  return (
    <AppShell>
      <Section className="space-y-3 pt-6">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </Section>
    </AppShell>
  );
}
