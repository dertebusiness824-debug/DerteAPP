import { OAuth2Client } from 'google-auth-library';
import config from '../config.js';
import { badRequest, serviceUnavailable } from '../lib/errors.js';

let client = null;

function getClient() {
  if (!config.google.clientId) return null;
  if (!client) client = new OAuth2Client(config.google.clientId);
  return client;
}

/**
 * Verifies a Google Identity Services ID token and returns the profile.
 * In tests, `credential` may be a JSON string prefixed with `test:` so suites
 * do not need a real Google Client ID.
 */
export async function verifyGoogleCredential(credential) {
  if (!credential || typeof credential !== 'string') {
    throw badRequest('Falta la credencial de Google', { code: 'google_credential_missing' });
  }

  if (credential.startsWith('test:') && (config.isTest || !config.isProduction)) {
    try {
      const profile = JSON.parse(credential.slice(5));
      if (!profile.email || !profile.sub) throw new Error('incomplete');
      return {
        sub: String(profile.sub),
        email: String(profile.email).trim().toLowerCase(),
        name: profile.name ? String(profile.name).trim() : null,
        email_verified: profile.email_verified !== false,
      };
    } catch {
      throw badRequest('Credencial de prueba de Google no válida', { code: 'google_credential_invalid' });
    }
  }

  const oauth = getClient();
  if (!oauth) {
    throw serviceUnavailable('Google Sign-In no está configurado. Define GOOGLE_CLIENT_ID.', {
      code: 'google_not_configured',
    });
  }

  try {
    const ticket = await oauth.verifyIdToken({
      idToken: credential,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub) {
      throw badRequest('La cuenta de Google no devolvió un correo válido', { code: 'google_email_missing' });
    }
    if (payload.email_verified === false) {
      throw badRequest('Verifica tu correo de Google e inténtalo de nuevo', { code: 'google_email_unverified' });
    }
    return {
      sub: payload.sub,
      email: String(payload.email).trim().toLowerCase(),
      name: payload.name ? String(payload.name).trim() : null,
      email_verified: true,
    };
  } catch (error) {
    if (error?.status) throw error;
    throw badRequest('No se pudo verificar el inicio de sesión con Google', {
      code: 'google_credential_invalid',
    });
  }
}

export const googleConfigured = () => Boolean(config.google.clientId) || config.isTest;
