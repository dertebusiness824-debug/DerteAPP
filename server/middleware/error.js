import { ZodError } from 'zod';
import config from '../config.js';
import { HttpError } from '../lib/errors.js';

export const notFoundHandler = (req, res) => {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}`, code: 'route_not_found' } });
};

// Postgres error codes worth translating into a clean client-facing status.
function translatePgError(error) {
  const detail = `${error?.detail ?? ''} ${error?.message ?? ''} ${error?.constraint ?? ''}`.toLowerCase();
  switch (error?.code) {
    case '23505':
      return [409, 'Ese registro ya existe', 'db_23505'];
    case '23503':
      // Prefer precise constraint / column matches — bare "profiles" used to
      // mis-label appointments.accepted_by failures as shop-member link errors.
      if (
        detail.includes('shop_members_user_id_fkey') ||
        detail.includes('shop_members_user_id') ||
        (detail.includes('shop_members') && detail.includes('user_id'))
      ) {
        return [
          400,
          'No se pudo vincular el usuario al taller (referencia de usuario inválida). Recarga e inténtalo de nuevo.',
          'user_reference_not_found',
        ];
      }
      if (
        detail.includes('shop_members_shop_id_fkey') ||
        detail.includes('shop_members_shop') ||
        (detail.includes('shop_members') && detail.includes('shop_id'))
      ) {
        return [400, 'El código de referencia del taller no existe.', 'shop_reference_not_found'];
      }
      if (detail.includes('accepted_by') || detail.includes('appointments_accepted_by')) {
        return [
          400,
          'No se pudo confirmar la cita con tu usuario. Recarga e inicia sesión de nuevo.',
          'appointment_actor_invalid',
        ];
      }
      if (detail.includes('audit_log')) {
        return [400, 'No se pudo registrar la auditoría del cambio.', 'audit_reference_not_found'];
      }
      if (detail.includes('profiles') && detail.includes('shop_members')) {
        return [
          400,
          'No se pudo vincular el usuario al taller (referencia de usuario inválida). Recarga e inténtalo de nuevo.',
          'user_reference_not_found',
        ];
      }
      return [
        400,
        'Hay una referencia inválida en la base de datos. Comprueba el taller seleccionado.',
        'db_23503',
      ];
    case '23514':
      return [400, 'Un valor está fuera del rango permitido', 'db_23514'];
    case '22P02':
      return [400, 'Identificador o valor con formato incorrecto', 'db_22P02'];
    default:
      return null;
  }
}

function isProviderWebhookPath(req) {
  const path = String(req?.originalUrl || req?.url || '');
  return path.includes('/webhooks/');
}

export function errorHandler(error, req, res, _next) {
  // Provider webhooks (Retell / Zadarma): never return 4xx/5xx that back up
  // their delivery queues ("Queue is full."). Always ACK if we somehow land here.
  if (isProviderWebhookPath(req)) {
    if (!config.isTest) {
      console.error(`[webhook-error] ${req.method} ${req.originalUrl}`, error?.message || error);
    }
    if (!res.headersSent) return res.status(200).json({ received: true });
    return undefined;
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({ field: issue.path.join('.') || '(body)', message: issue.message }));
    return res.status(400).json({
      error: { message: details[0]?.message ?? 'Invalid request', code: 'validation_failed', details },
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({
      error: { message: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) },
    });
  }

  const translated = translatePgError(error);
  if (translated) {
    const [status, message, code] = translated;
    if (!config.isTest) console.error(`[db:${error.code}] ${error.message}`);
    return res.status(status).json({ error: { message, code } });
  }

  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Request body is not valid JSON', code: 'invalid_json' } });
  }

  if (!config.isTest) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, error);
  }
  return res.status(500).json({
    error: {
      message: 'Something went wrong on our side. Please try again.',
      code: 'internal_error',
      ...(config.isProduction ? {} : { debug: error?.message }),
    },
  });
}
