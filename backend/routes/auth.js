const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomInt, createHmac } = require('crypto');
const rateLimit = require('express-rate-limit');
const { query, withTransaction } = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const audit = require('../utils/audit');
const sendMail = require('../utils/mailer');
const { passwordError } = require('../utils/validation');
const { loginDenialMessage } = require('../utils/accountAccess');

const router = express.Router();
const sensitiveLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const hashCode = (code) => createHmac('sha256', config.jwtSecret).update(code).digest('hex');

router.post('/register', sensitiveLimit, async (req, res, next) => {
  try {
    const { full_name, email, username, password, confirm_password } = req.body;
    if (!full_name || !email || !username || !password || !confirm_password) return res.status(400).json({ error: 'Complete all required fields.' });
    const cleanName = String(full_name).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = String(username).trim();
    if (!cleanName || cleanName.length > 150 || normalizedEmail.length > 150 || normalizedUsername.length < 2 || normalizedUsername.length > 80) {
      return res.status(400).json({ error: 'Name, email, or username exceeds the allowed length.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const invalidPassword = passwordError(password);
    if (invalidPassword) return res.status(400).json({ error: invalidPassword });
    if (typeof confirm_password !== 'string') return res.status(400).json({ error: 'Confirmation password must be text.' });
    if (password !== confirm_password) return res.status(400).json({ error: 'Passwords do not match.' });
    const existing = await query('SELECT id FROM users WHERE email = $1 OR lower(username) = lower($2)', [normalizedEmail, normalizedUsername]);
    if (existing.rowCount) return res.status(409).json({ error: 'That email or username is already registered.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const code = String(randomInt(100000, 1000000));
    const tokenHash = hashCode(code);
    await withTransaction(async (client) => {
      const created = await client.query(
        `INSERT INTO users (full_name, email, username, password_hash, role, account_status, is_active)
         VALUES ($1, $2, $3, $4, 'viewer', 'PENDING', FALSE) RETURNING id`,
        [cleanName, normalizedEmail, normalizedUsername, passwordHash],
      );
      await client.query(
        `INSERT INTO verification_tokens (user_id, code, expires_at) VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
        [created.rows[0].id, tokenHash],
      );
      await audit(created.rows[0].id, 'registration', 'Account registered.', String(created.rows[0].id), req.ip, client.query.bind(client));
    });
    await sendMail({ to: normalizedEmail, subject: 'LogSphere email verification', text: `Your verification code is ${code}. It expires in 15 minutes.` });
    res.status(201).json({
      message: 'Your registration has been submitted successfully. Your account is awaiting administrator approval. You will be able to access LogSphere once your account has been approved.',
      requiresEmailVerification: true,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-email', sensitiveLimit, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    if (!email || !code) return res.status(400).json({ error: 'Email and verification code are required.' });
    const user = await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT vt.id AS token_id, u.id AS user_id, u.account_status
         FROM verification_tokens vt JOIN users u ON u.id = vt.user_id
         WHERE u.email = $1 AND vt.code = $2 AND vt.purpose = 'email_verification'
           AND vt.used_at IS NULL AND vt.expires_at > NOW()
         ORDER BY vt.created_at DESC LIMIT 1 FOR UPDATE`,
        [email, hashCode(code)],
      );
      if (!result.rowCount) return null;
      await client.query('UPDATE verification_tokens SET used_at = NOW() WHERE id = $1', [result.rows[0].token_id]);
      await client.query('UPDATE users SET is_verified = TRUE, updated_at = NOW() WHERE id = $1', [result.rows[0].user_id]);
      await audit(result.rows[0].user_id, 'email_verified', 'Email address verified.', String(result.rows[0].user_id), req.ip, client.query.bind(client));
      return { id: result.rows[0].user_id, accountStatus: result.rows[0].account_status };
    });
    if (!user) return res.status(400).json({ error: 'Verification code is invalid or expired.' });
    res.json({
      message: user.accountStatus === 'PENDING'
        ? 'Email verified. Your account is awaiting administrator approval.'
        : 'Email verified. You can now sign in.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/resend-verification', sensitiveLimit, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const found = await query('SELECT id, is_verified FROM users WHERE email = $1', [email]);
    if (!found.rowCount || found.rows[0].is_verified) return res.json({ message: 'If verification is needed, a new code will be sent.' });
    const code = String(randomInt(100000, 1000000));
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO verification_tokens (user_id, code, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
        [found.rows[0].id, hashCode(code)],
      );
      await sendMail({ to: email, subject: 'LogSphere email verification', text: `Your verification code is ${code}. It expires in 15 minutes.` });
    });
    res.json({ message: 'A new verification code has been sent.' });
  } catch (error) {
    next(error);
  }
});

router.post('/login', sensitiveLimit, async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || '').trim();
    const password = String(req.body.password || '');
    if (!identifier || !password) return res.status(400).json({ error: 'Enter your email or username and password.' });
    if (Buffer.byteLength(password, 'utf8') > 72) {
      console.warn('Login rejected: reason=password_too_long');
      return res.status(401).json({ error: 'Invalid email/username or password.' });
    }
    const result = await query(
      `SELECT id, full_name, email, username, role, password_hash, account_status, is_active, is_verified
       FROM users WHERE lower(email) = $1 OR lower(username) = $1 LIMIT 1`,
      [identifier.toLowerCase()],
    );
    const user = result.rows[0];
    const valid = user && await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      console.warn(`Login rejected: reason=${user ? 'password_mismatch' : 'user_not_found'}`);
      await audit(user?.id, 'failed_login', 'Failed sign-in attempt.', user?.id ? String(user.id) : null, req.ip);
      return res.status(401).json({ error: 'Invalid email/username or password.' });
    }
    const denialMessage = loginDenialMessage(user);
    if (denialMessage) return res.status(403).json({ error: denialMessage });
    const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '8h' });
    await audit(user.id, 'login', 'User signed in.', String(user.id), req.ip);
    delete user.password_hash;
    res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password', sensitiveLimit, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const user = await query('SELECT id, is_active FROM users WHERE email = $1', [email]);
    if (user.rowCount && user.rows[0].is_active) {
      const code = String(randomInt(100000, 1000000));
      await query(
        `INSERT INTO verification_tokens (user_id, code, purpose, expires_at)
         VALUES ($1, $2, 'password_reset', NOW() + INTERVAL '15 minutes')`,
        [user.rows[0].id, hashCode(code)],
      );
      await sendMail({ to: email, subject: 'LogSphere password reset', text: `Your password reset code is ${code}. It expires in 15 minutes.` });
    }
    res.json({ message: 'If an active account exists for that email, a password reset code has been sent.' });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', sensitiveLimit, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const password = req.body.password;
    if (!email || !code || !password) return res.status(400).json({ error: 'Email, code, and new password are required.' });
    const invalidPassword = passwordError(password);
    if (invalidPassword) return res.status(400).json({ error: invalidPassword });
    const passwordHash = await bcrypt.hash(password, 12);
    const updatedUser = await withTransaction(async (client) => {
      const token = await client.query(
        `SELECT vt.id AS token_id, u.id AS user_id FROM verification_tokens vt
         JOIN users u ON u.id=vt.user_id
         WHERE u.email=$1 AND vt.code=$2 AND vt.purpose='password_reset'
           AND vt.used_at IS NULL AND vt.expires_at>NOW()
         ORDER BY vt.created_at DESC LIMIT 1 FOR UPDATE`,
        [email, hashCode(code)],
      );
      if (!token.rowCount) return null;
      await client.query('UPDATE verification_tokens SET used_at=NOW() WHERE id=$1', [token.rows[0].token_id]);
      await client.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [passwordHash, token.rows[0].user_id]);
      await audit(token.rows[0].user_id, 'password_reset', 'Account password reset.', String(token.rows[0].user_id), req.ip, client.query.bind(client));
      return token.rows[0].user_id;
    });
    if (!updatedUser) return res.status(400).json({ error: 'Password reset code is invalid or expired.' });
    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await audit(req.user.id, 'logout', 'User signed out.', String(req.user.id), req.ip);
    res.json({ message: 'Signed out.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
