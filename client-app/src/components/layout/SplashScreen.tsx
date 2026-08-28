import { appConfig } from '@/config';
import { LogoMark } from '@/components/ui/Icons';

/** Pantalla de arranque mientras se resuelve el origen de datos. */
export function SplashScreen({ error }: { error?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-accent-soft text-accent">
        <LogoMark className="size-9" />
      </div>
      <div>
        <p className="text-lg font-semibold text-ink">{appConfig.appName}</p>
        <p className="mt-1 text-sm text-muted">
          {error ? 'No pudimos iniciar la aplicación' : 'Buscando talleres cerca de ti…'}
        </p>
      </div>

      {error ? (
        <p className="max-w-xs rounded-card border border-urgent/25 bg-urgent-soft px-4 py-3 text-sm text-urgent-strong">
          {error}
        </p>
      ) : (
        <span
          aria-hidden="true"
          className="size-6 animate-spin rounded-full border-2 border-accent/25 border-t-accent"
        />
      )}
    </div>
  );
}
