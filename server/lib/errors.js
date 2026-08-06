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

export const badRequest = (message = 'Invalid request', options) => new HttpError(400, message, options);
export const unauthorized = (message = 'Authentication required', options) => new HttpError(401, message, options);
export const forbidden = (message = 'Not allowed', options) => new HttpError(403, message, options);
export const notFound = (message = 'Not found', options) => new HttpError(404, message, options);
export const conflict = (message = 'Conflict', options) => new HttpError(409, message, options);
export const tooManyRequests = (message = 'Too many requests', options) => new HttpError(429, message, options);

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
