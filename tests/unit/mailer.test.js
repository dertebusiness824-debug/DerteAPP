import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sendCancellationEmail, sendEmail } from '../../server/services/mailer.js';

describe('mailer', () => {
  it('skips quietly when no recipient is provided', async () => {
    const result = await sendEmail({ to: '', subject: 'Hi', text: 'Body' });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'missing_recipient');
  });

  it('skips cancellation when the booking has no customer email', async () => {
    const result = await sendCancellationEmail({
      shop: { name: 'Taller Demo' },
      appointment: { customer_name: 'Ana', reference: 'ABC', scheduled_local: 'hoy' },
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no_customer_email');
  });

  it('skips (not configured) rather than throwing when SMTP/Resend is absent', async () => {
    const result = await sendCancellationEmail({
      shop: { name: 'Taller Demo' },
      appointment: {
        customer_name: 'Ana',
        customer_email: 'ana@example.com',
        reference: 'ABC123',
        scheduled_local: 'lun 10:00',
        service_type: 'ITV',
      },
      reason: 'Sin piezas',
    });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not_configured');
  });
});
