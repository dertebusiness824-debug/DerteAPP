import { ZodError } from 'zod';
import config from '../config.js';
import { HttpError } from '../lib/errors.js';

export const notFoundHandler = (req, res) => {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}`, code: 'route_not_found' } });
};

// Postgres error codes worth translating into a clean client-facing status.
const PG_STATUS = {
  '23505': [409, 'That record already exists'],
  '23503': [400, 'Referenced record does not exist'],
  '23514': [400, 'A value fell outside the allowed range'],
  '22P02': [400, 'Malformed identifier or value'],
};

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

  if (error?.code && PG_STATUS[error.code]) {
    const [status, message] = PG_STATUS[error.code];
    if (!config.isTest) console.error(`[db:${error.code}] ${error.message}`);
    return res.status(status).json({ error: { message, code: `db_${error.code}` } });
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
