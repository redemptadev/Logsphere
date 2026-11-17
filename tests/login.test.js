const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const config = require('../backend/config');
const database = require('../backend/db');

test('login normalizes identifiers, preserves passwords, and logs only rejection reasons', async (t) => {
  const originalQuery = database.query;
  const originalJwtSecret = config.jwtSecret;
  const originalWarn = console.warn;
  const password = '  correct password  ';
  const user = {
    id: 21,
    full_name: 'Admin User',
    email: 'admin@example.test',
    username: 'rinadev',
    role: 'admin',
    password_hash: await bcrypt.hash(password, 4),
    account_status: 'APPROVED',
    is_active: true,
    is_verified: true,
  };
  const diagnostics = [];
  let userLookups = 0;
  config.jwtSecret = 'test-secret-with-more-than-thirty-two-characters';
  database.query = async (sql, values) => {
    if (sql.includes('FROM users WHERE lower(email)')) {
      userLookups += 1;
      assert.match(sql, /lower\(email\) = \$1 OR lower\(username\) = \$1/);
      return ['admin@example.test', 'rinadev'].includes(values[0])
        ? { rows: [{ ...user }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected mock database query: ${sql}`);
  };
  console.warn = (...args) => diagnostics.push(args.join(' '));

  const app = require('../backend/index');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.pool.end();
    database.query = originalQuery;
    config.jwtSecret = originalJwtSecret;
    console.warn = originalWarn;
  });

  const login = async (identifier, submittedPassword) => fetch(
    `http://127.0.0.1:${server.address().port}/api/auth/login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password: submittedPassword }),
    },
  );

  const success = await login('  ADMIN@EXAMPLE.TEST ', password);
  assert.equal(success.status, 200);
  const successBody = await success.json();
  assert.equal(successBody.user.username, 'rinadev');
  assert.equal(Object.hasOwn(successBody.user, 'password_hash'), false);

  const mismatch = await login('rinadev', 'wrong password');
  assert.equal(mismatch.status, 401);
  assert.equal((await mismatch.json()).error, 'Invalid email/username or password.');

  const missingUser = await login('missing@example.test', password);
  assert.equal(missingUser.status, 401);

  const tooLongPassword = `${password}${'x'.repeat(73)}`;
  const tooLong = await login('rinadev', tooLongPassword);
  assert.equal(tooLong.status, 401);
  assert.equal(userLookups, 3);
  assert.deepEqual(diagnostics, [
    'Login rejected: reason=password_mismatch',
    'Login rejected: reason=user_not_found',
    'Login rejected: reason=password_too_long',
  ]);
  assert.doesNotMatch(diagnostics.join(' '), /admin@example\.test|rinadev|correct password|wrong password|password_hash/);
});
