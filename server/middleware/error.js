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
      if (detail.includes('shop_members_shop') || detail.includes('shops')) {
        return [400, 'El código de referencia del taller no existe.', 'shop_reference_not_found'];
      }
      if (detail.includes('shop_members_user') || detail.includes('profiles')) {
        return [
          400,
          'No se pudo vincular el usuario al taller (referencia de usuario inválida). Recarga e inténtalo de nuevo.',
          'user_reference_not_found',
        ];
      }
      if (detail.includes('audit_log')) {
        return [400, 'No se pudo registrar la auditoría del cambio.', 'audit_reference_not_found'];
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

export function errorHandler(error, req, res, _next) {
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
