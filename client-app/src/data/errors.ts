/** Errores de datos con mensaje listo para mostrar al conductor. */

export class MarketplaceError extends Error {
  readonly code: string;

  constructor(message: string, code = 'unknown') {
    super(message);
    this.name = 'MarketplaceError';
    this.code = code;
  }
}

/**
 * Los RPC lanzan `RAISE EXCEPTION '<code>' USING HINT = '<texto>'`, así que
 * PostgREST devuelve el código en `message` y el texto para el usuario en
 * `hint`. Aquí se traduce, con respaldo por si el hint no llega.
 */
const MESSAGES: Record<string, string> = {
  auth_required: 'Necesitas iniciar sesión para completar esta acción.',
  invalid_name: 'Escribe tu nombre completo.',
  invalid_phone: 'Necesitamos un teléfono de contacto válido.',
  shop_unavailable: 'Este taller no acepta solicitudes online ahora mismo.',
  too_soon: 'Este taller necesita más antelación. Prueba con una hora más tarde.',
  too_far: 'Esa fecha está fuera del calendario del taller.',
  slot_taken: 'Ese hueco acaba de ocuparse. Elige otra hora.',
  booking_not_found: 'No encontramos esa cita.',
  booking_not_cancellable: 'Esa cita ya está cerrada y no se puede cancelar.',
};

interface PostgrestLikeError {
  message?: string;
  hint?: string | null;
  details?: string | null;
  code?: string | null;
}

export function toMarketplaceError(error: unknown, fallback = 'No se pudo completar la operación.'): MarketplaceError {
  if (error instanceof MarketplaceError) return error;

  const raw = (error ?? {}) as PostgrestLikeError;
  const rawMessage = String(raw.message ?? '').trim();
  const known = MESSAGES[rawMessage];

  if (known) return new MarketplaceError(known, rawMessage);
  if (raw.hint) return new MarketplaceError(String(raw.hint), rawMessage || 'rpc_error');

  // Errores de red o de RLS: mensaje corto y accionable.
  if (/failed to fetch|networkerror|load failed/i.test(rawMessage)) {
    return new MarketplaceError('Sin conexión con el servidor. Inténtalo de nuevo.', 'network');
  }
  if (raw.code === '42501' || /row-level security/i.test(rawMessage)) {
    return new MarketplaceError('No tienes permiso para esta acción.', 'forbidden');
  }

  return new MarketplaceError(rawMessage || fallback, raw.code ?? 'unknown');
}

/** Desenvuelve una respuesta `{ data, error }` de supabase-js. */
export function unwrap<T>(
  response: { data: T | null; error: unknown },
  fallback?: string,
): T {
  if (response.error) throw toMarketplaceError(response.error, fallback);
  return response.data as T;
}
