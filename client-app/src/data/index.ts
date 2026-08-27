/** Selección del origen de datos al arrancar la app. */
import { appConfig, resolveSupabaseCredentials } from '@/config';
import { DemoRepository } from './demoRepository';
import { MarketplaceError } from './errors';
import type { MarketplaceRepository } from './types';

export interface RepositoryBootstrap {
  repository: MarketplaceRepository;
  /** Aviso a mostrar en la interfaz cuando no se pudo usar Supabase. */
  notice: string | null;
}

export async function createRepository(): Promise<RepositoryBootstrap> {
  if (appConfig.dataMode === 'demo') {
    return { repository: new DemoRepository(), notice: null };
  }

  const credentials = await resolveSupabaseCredentials();

  if (!credentials) {
    if (appConfig.dataMode === 'supabase') {
      throw new MarketplaceError(
        'Falta la configuración de Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY).',
        'missing_config',
      );
    }
    return {
      repository: new DemoRepository(),
      notice:
        'Modo demo: sin credenciales de Supabase se muestra un catálogo local de ejemplo.',
    };
  }

  // El cliente de Supabase es la dependencia más pesada de la app, así que se
  // carga en su propio trozo y solo cuando hay credenciales de verdad.
  const { SupabaseRepository } = await import('./supabaseRepository');
  return { repository: new SupabaseRepository(credentials), notice: null };
}

export { DemoRepository };
export * from './types';
