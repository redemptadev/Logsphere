const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const config = require('../backend/config');
const database = require('../backend/db');

test('resend-verification only succeeds after SMTP acceptance and verify-email consumes that code', async (t) => {
  const originalQuery = database.query;
  const originalTransaction = database.withTransaction;
  const originalCreateTransport = nodemailer.createTransport;
  const originalJwtSecret = config.jwtSecret;
  const originalMail = { ...config.mail };
  const originalConsoleError = console.error;
  const state = {
    user: { id: 17, email: 'new-user@example.test', is_verified: false },
    tokens: [],
    delivered: null,
    deliveryMode: 'accept',
    diagnostics: null,
  };
  config.jwtSecret = 'test-secret-with-more-than-thirty-two-characters';
  config.mail = {
    host: 'smtp-relay.brevo.com',
    port: 587,
    user: 'test-smtp-user',
    pass: 'test-smtp-password',
    from: 'LogSphere <no-reply@example.test>',
  };
  database.query = async (sql, values) => {
    if (sql.includes('SELECT id, is_verified FROM users')) {
      return state.user.email === values[0] ? { rows: [{ ...state.user }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected mock database query: ${sql}`);
  };
  database.withTransaction = async (operation) => {
    const txTokens = state.tokens.map((token) => ({ ...token }));
    let txVerified = state.user.is_verified;
    const client = {
      query: async (sql, values) => {
        if (sql.includes('INSERT INTO verification_tokens')) {
          txTokens.push({
            id: txTokens.length + 1,
            user_id: state.user.id,
            code: values[1],
            used_at: null,
          });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT vt.id AS token_id')) {
          const token = txTokens.slice().reverse().find((item) => item.code === values[1] && !item.used_at);
          return token
            ? { rows: [{ token_id: token.id, user_id: state.user.id, account_status: 'PENDING' }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.includes('UPDATE verification_tokens SET used_at')) {
          const token = txTokens.find((item) => item.id === values[0]);
          if (token) token.used_at = new Date();
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE users SET is_verified')) {
          txVerified = true;
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 };
        throw new Error(`Unexpected mock transaction query: ${sql}`);
      },
    };
    const result = await operation(client);
    state.tokens = txTokens;
    state.user.is_verified = txVerified;
    return result;
  };
  nodemailer.createTransport = (options) => ({
    sendMail: async (message) => {
      assert.equal(options.host, 'smtp-relay.brevo.com');
      assert.equal(options.port, 587);
      assert.equal(options.secure, false);
      assert.equal(options.requireTLS, true);
      state.delivered = message;
      if (state.deliveryMode === 'reject') {
        const error = new Error('554 5.7.1 sender not authorized for sender@example.com; auth=secret token=123456');
        error.code = 'EENVELOPE';
        error.responseCode = 554;
        error.command = 'MAIL FROM';
        error.response = error.message;
        throw error;
      }
      return { accepted: [message.to], rejected: [], responseCode: 250, response: '250 accepted' };
    },
  });
  console.error = (...args) => { state.diagnostics = args; };

  const app = require('../backend/index');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.pool.end();
    database.query = originalQuery;
    database.withTransaction = originalTransaction;
    nodemailer.createTransport = originalCreateTransport;
    config.jwtSecret = originalJwtSecret;
    config.mail = originalMail;
    console.error = originalConsoleError;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
  const resendResponse = await fetch(`${baseUrl}/resend-verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: state.user.email }),
  });
  assert.equal(resendResponse.status, 200);
  assert.match((await resendResponse.json()).message, /verification code has been sent/i);
  const code = state.delivered.text.match(/\b\d{6}\b/)[0];
  assert.equal(state.tokens.length, 1);

  const verifyResponse = await fetch(`${baseUrl}/verify-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: state.user.email, code }),
  });
  assert.equal(verifyResponse.status, 200);
  assert.match((await verifyResponse.json()).message, /email verified/i);
  assert.equal(state.user.is_verified, true);

  state.user.is_verified = false;
  state.tokens = [];
  state.deliveryMode = 'reject';
  const rejectedResponse = await fetch(`${baseUrl}/resend-verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: state.user.email }),
  });
  assert.equal(rejectedResponse.status, 502);
  assert.match((await rejectedResponse.json()).error, /SMTP 554/i);
  assert.equal(state.tokens.length, 0);
  const diagnostic = JSON.stringify(state.diagnostics);
  assert.match(diagnostic, /responseCode.*554/);
  assert.doesNotMatch(diagnostic, /sender@example\.com|123456|secret/);

  const invalidVerifyResponse = await fetch(`${baseUrl}/verify-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: state.user.email, code: '123456' }),
  });
  assert.equal(invalidVerifyResponse.status, 400);
});
