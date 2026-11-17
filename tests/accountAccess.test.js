const test = require('node:test');
const assert = require('node:assert/strict');
const { loginDenialMessage } = require('../backend/utils/accountAccess');

test('pending and rejected registrations receive their specific sign-in messages', () => {
  assert.equal(loginDenialMessage({ account_status: 'PENDING' }), 'Your account is awaiting administrator approval.');
  assert.equal(loginDenialMessage({ account_status: 'REJECTED' }), 'Your registration was not approved. Please contact the administrator.');
});

test('approved accounts still require activation and email verification', () => {
  assert.equal(loginDenialMessage({ account_status: 'APPROVED', is_active: false, is_verified: true }), 'Your account is inactive. Please contact the administrator.');
  assert.equal(loginDenialMessage({ account_status: 'APPROVED', is_active: true, is_verified: false }), 'Verify your email address before signing in.');
  assert.equal(loginDenialMessage({ account_status: 'APPROVED', is_active: true, is_verified: true }), null);
});

test('unknown or missing account states cannot access the application', () => {
  assert.equal(loginDenialMessage(null), 'This account cannot access LogSphere.');
  assert.equal(loginDenialMessage({ account_status: 'UNKNOWN', is_active: true, is_verified: true }), 'This account cannot access LogSphere.');
});
