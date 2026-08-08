/**
 * Lightweight outbound mail for booking notifications.
 * Supports Resend (HTTP) and SMTP (nodemailer). When neither is configured,
 * logs the payload so cancel still succeeds in dev/test.
 */
import nodemailer from 'nodemailer';
import config from '../config.js';

function mailConfig() {
  return {
    from: (process.env.MAIL_FROM || process.env.SMTP_FROM || `DerteApp <noreply@${new URL(config.appUrl).hostname}>`).trim(),
    resendApiKey: (process.env.RESEND_API_KEY || '').trim(),
    smtpUrl: (process.env.SMTP_URL || '').trim(),
    smtpHost: (process.env.SMTP_HOST || '').trim(),
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: (process.env.SMTP_USER || '').trim(),
    smtpPass: (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim(),
    smtpSecure: ['1', 'true', 'yes'].includes(String(process.env.SMTP_SECURE || '').toLowerCase()),
  };
}

export function mailerConfigured() {
  const mail = mailConfig();
  return Boolean(mail.resendApiKey || mail.smtpUrl || (mail.smtpHost && mail.smtpUser));
}

async function sendViaResend({ from, to, subject, text, html }, apiKey) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status}: ${body.slice(0, 200)}`);
  }
  return { provider: 'resend' };
}

async function sendViaSmtp({ from, to, subject, text, html }, mail) {
  const transport = mail.smtpUrl
    ? nodemailer.createTransport(mail.smtpUrl)
    : nodemailer.createTransport({
        host: mail.smtpHost,
        port: mail.smtpPort,
        secure: mail.smtpSecure,
        auth: mail.smtpUser ? { user: mail.smtpUser, pass: mail.smtpPass } : undefined,
      });
  await transport.sendMail({ from, to, subject, text, html });
  return { provider: 'smtp' };
}

/** Sends one email. Never throws to callers that want best-effort delivery. */
export async function sendEmail({ to, subject, text, html }, { soft = true } = {}) {
  const mail = mailConfig();
  const payload = {
    from: mail.from,
    to: String(to || '').trim(),
    subject: String(subject || '').trim(),
    text: String(text || '').trim(),
    html: html || `<pre style="font-family:sans-serif">${String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')}</pre>`,
  };

  if (!payload.to || !payload.to.includes('@')) {
    return { ok: false, skipped: true, reason: 'missing_recipient' };
  }

  try {
    if (mail.resendApiKey) {
      const result = await sendViaResend(payload, mail.resendApiKey);
      return { ok: true, ...result };
    }
    if (mail.smtpUrl || mail.smtpHost) {
      const result = await sendViaSmtp(payload, mail);
      return { ok: true, ...result };
    }
    console.info('[mailer] not configured — email skipped', {
      to: payload.to,
      subject: payload.subject,
    });
    return { ok: false, skipped: true, reason: 'not_configured' };
  } catch (error) {
    console.error('[mailer] send failed', error.message);
    if (!soft) throw error;
    return { ok: false, error: error.message };
  }
}

/** Builds and sends the customer cancellation notice. */
export async function sendCancellationEmail({ shop, appointment, reason = null }) {
  const email = appointment.customer_email;
  if (!email) {
    return { ok: false, skipped: true, reason: 'no_customer_email' };
  }

  const when = appointment.scheduled_local
    || appointment.scheduled_at
    || '';
  const shopName = shop?.name || 'el taller';
  const reference = appointment.reference || '';
  const subject = `Reserva cancelada — ${shopName}`;
  const reasonLine = reason ? `\nMotivo: ${reason}\n` : '\n';
  const text = [
    `Hola ${appointment.customer_name || ''},`,
    '',
    `Tu reserva${reference ? ` ${reference}` : ''} en ${shopName} ha sido cancelada por el taller.`,
    when ? `Fecha prevista: ${when}` : null,
    appointment.service_type ? `Servicio: ${appointment.service_type}` : null,
    reasonLine.trim() ? `Motivo: ${reason}` : null,
    '',
    'Si necesitas una nueva cita, contacta con el taller o vuelve a reservar desde su web.',
    '',
    `— ${shopName} · DerteApp`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');

  return sendEmail({ to: email, subject, text });
}
