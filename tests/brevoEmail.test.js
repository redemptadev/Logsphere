const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../backend/config');
const sendMail = require('../backend/utils/mailer');

test('Brevo API sends the same email payload over HTTPS and returns acceptance', async (t) => {
  const originalMail = { ...config.mail };
  const originalFetch = global.fetch;
  config.mail = {
    ...config.mail,
    from: '"LogSphere" <no-reply@example.test>',
    brevoApiKey: 'test-brevo-api-key',
  };
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['api-key'], 'test-brevo-api-key');
    assert.match(options.signal.constructor.name, /AbortSignal/);
    assert.deepEqual(JSON.parse(options.body), {
      sender: { name: 'LogSphere', email: 'no-reply@example.test' },
      to: [{ email: 'recipient@example.test' }],
      subject: 'Verification',
      textContent: 'Your code is 123456.',
    });
    return {
      status: 201,
      json: async () => ({ messageId: 'test-message-id' }),
    };
  };
  t.after(() => {
    config.mail = originalMail;
    global.fetch = originalFetch;
  });

  const result = await sendMail({
    to: ' RECIPIENT@EXAMPLE.TEST ',
    subject: 'Verification',
    text: 'Your code is 123456.',
  });
  assert.equal(result.messageId, 'test-message-id');
  assert.deepEqual(result.accepted, ['recipient@example.test']);
  assert.deepEqual(result.rejected, []);
});

test('Brevo API failures remain generic and do not log response content or credentials', async (t) => {
  const originalMail = { ...config.mail };
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const diagnostics = [];
  config.mail = {
    ...config.mail,
    from: 'no-reply@example.test',
    brevoApiKey: 'test-secret-api-key',
  };
  global.fetch = async () => ({
    status: 401,
    json: async () => ({
      code: 'unauthorized',
      message: 'invalid test-secret-api-key for recipient@example.test',
    }),
  });
  console.error = (...args) => diagnostics.push(args);
  t.after(() => {
    config.mail = originalMail;
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  await assert.rejects(
    sendMail({ to: 'recipient@example.test', subject: 'Verification', text: 'Your code is 123456.' }),
    (error) => error.name === 'EmailDeliveryError' && error.status === 502,
  );
  assert.deepEqual(diagnostics, [
    ['[email] Brevo API delivery failed', { status: 401 }],
  ]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /test-secret-api-key|recipient@example\.test|123456/);
});
