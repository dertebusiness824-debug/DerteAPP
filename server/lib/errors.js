export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = options.code ?? null;
    this.details = options.details ?? null;
    this.expose = true;
  }
}

export const badRequest = (message = 'Solicitud no válida', options) => new HttpError(400, message, options);
export const unauthorized = (message = 'Debes iniciar sesión', options) => new HttpError(401, message, options);
export const forbidden = (message = 'No tienes permiso', options) => new HttpError(403, message, options);
export const notFound = (message = 'No encontrado', options) => new HttpError(404, message, options);
export const conflict = (message = 'Conflicto', options) => new HttpError(409, message, options);
export const tooManyRequests = (message = 'Demasiadas solicitudes', options) => new HttpError(429, message, options);
export const serviceUnavailable = (message = 'Servicio no disponible', options) => new HttpError(503, message, options);

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
