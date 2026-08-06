import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { buildQuery, signRequest, verifyWebhook } from '../../server/services/zadarma.js';

const SECRET = 'test-secret';

/** Reference implementation of Zadarma's documented PHP signing recipe. */
function referenceSignature(method, params, secret) {
  const query = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  const md5 = crypto.createHash('md5').update(query).digest('hex');
  const hmac = crypto.createHmac('sha1', secret).update(`${method}${query}${md5}`).digest('hex');
  return Buffer.from(hmac).toString('base64');
}

describe('Zadarma request signing', () => {
  it('sorts parameters alphabetically', () => {
    assert.equal(buildQuery({ to: '34600111222', from: '34600333444' }), 'from=34600333444&to=34600111222');
  });

  it('drops empty parameters instead of signing them as blanks', () => {
    assert.equal(buildQuery({ from: '1', sip: '', predicted: null, to: '2' }), 'from=1&to=2');
  });

  it('encodes spaces the way PHP http_build_query does', () => {
    assert.equal(buildQuery({ message: 'hello world' }), 'message=hello+world');
  });

  it('matches the documented signature recipe', () => {
    const params = { from: '34600111222', to: '34600333444' };
    const { signature } = signRequest('/v1/request/callback/', params, SECRET);
    assert.equal(signature, referenceSignature('/v1/request/callback/', params, SECRET));
  });

  it('produces a stable signature for the balance call', () => {
    const { query, signature } = signRequest('/v1/info/balance/', {}, SECRET);
    assert.equal(query, '');
    assert.equal(signature, referenceSignature('/v1/info/balance/', {}, SECRET));
  });
});

describe('Zadarma webhook verification', () => {
  const sign = (value) =>
    Buffer.from(crypto.createHmac('sha1', SECRET).update(value).digest('hex')).toString('base64');

  it('accepts a correctly signed NOTIFY_START', () => {
    const payload = {
      event: 'NOTIFY_START',
      caller_id: '34600111222',
      called_did: '34910000000',
      pbx_call_id: 'abc123',
    };
    const signature = sign(`${payload.event}${payload.caller_id}${payload.called_did}`);
    assert.equal(verifyWebhook(payload, signature, SECRET), true);
  });

  it('accepts a correctly signed NOTIFY_END including the duration', () => {
    const payload = {
      event: 'NOTIFY_END',
      caller_id: '34600111222',
      called_did: '34910000000',
      duration: '95',
      disposition: 'answered',
    };
    const signature = sign(
      `${payload.event}${payload.caller_id}${payload.called_did}${payload.duration}`,
    );
    assert.equal(verifyWebhook(payload, signature, SECRET), true);
  });

  it('rejects a tampered payload', () => {
    const payload = { event: 'NOTIFY_START', caller_id: '34600111222', called_did: '34910000000' };
    const signature = sign('NOTIFY_START3460011122234910000000');
    assert.equal(verifyWebhook({ ...payload, caller_id: '34699999999' }, signature, SECRET), false);
  });

  it('rejects a missing or malformed signature', () => {
    const payload = { event: 'NOTIFY_START', caller_id: '1', called_did: '2' };
    assert.equal(verifyWebhook(payload, null, SECRET), false);
    assert.equal(verifyWebhook(payload, 'not-a-signature', SECRET), false);
    assert.equal(verifyWebhook(payload, '', SECRET), false);
  });

  it('falls back to sorted values for an event it does not know yet', () => {
    const payload = { event: 'NOTIFY_FUTURE', alpha: 'a', beta: 'b' };
    // Keys sorted alphabetically: alpha, beta, event.
    assert.equal(verifyWebhook(payload, sign('abNOTIFY_FUTURE'), SECRET), true);
  });
});
