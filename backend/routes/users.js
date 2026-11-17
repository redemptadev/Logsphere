const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');
const audit = require('../utils/audit');

const router = express.Router();
router.use(requireAuth, allowRoles('admin'));

const userFields = `id, full_name, email, username, role, account_status,
  is_active, is_verified, created_at, updated_at`;
const VALID_ROLES = ['admin', 'analyst', 'viewer'];
const ACCOUNT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

router.get('/pending', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ${userFields} FROM users
       WHERE account_status = 'PENDING'
       ORDER BY created_at ASC`,
    );
    res.json({ users: result.rows });
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const conditions = [];
    const values = [];
    if (req.query.role) {
      if (!VALID_ROLES.includes(req.query.role)) return res.status(400).json({ error: 'Role filter is invalid.' });
      values.push(req.query.role);
      conditions.push(`role = $${values.length}`);
    }
    if (req.query.account_status) {
      if (!ACCOUNT_STATUSES.includes(req.query.account_status)) return res.status(400).json({ error: 'Account status filter is invalid.' });
      values.push(req.query.account_status);
      conditions.push(`account_status = $${values.length}`);
    }
    if (req.query.search) {
      const search = String(req.query.search).trim();
      if (search.length > 200) return res.status(400).json({ error: 'Search text must be 200 characters or fewer.' });
      values.push(`%${search}%`);
      const index = values.length;
      conditions.push(`(full_name ILIKE $${index} OR email ILIKE $${index} OR username ILIKE $${index})`);
    }
    const result = await query(
      `SELECT ${userFields} FROM users ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT 500`,
      values,
    );
    res.json({ users: result.rows });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ${userFields} FROM users WHERE id=$1`,
      [req.params.id],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'User was not found.' });
    res.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const outcome = await withTransaction(async (client) => {
      const current = await client.query(
        'SELECT id, role, account_status FROM users WHERE id=$1 FOR UPDATE',
        [req.params.id],
      );
      if (!current.rowCount) return { status: 404 };
      if (current.rows[0].account_status !== 'PENDING') return { status: 409, reason: 'Only pending registrations can be approved.' };
      if (current.rows[0].role !== 'viewer') return { status: 409, reason: 'Pending registrations must retain the default viewer role before approval.' };

      const approved = await client.query(
        `UPDATE users SET account_status='APPROVED', is_active=TRUE, updated_at=NOW()
         WHERE id=$1 RETURNING ${userFields}`,
        [req.params.id],
      );
      await audit(
        req.user.id,
        'registration_approved',
        `Registration approved for ${approved.rows[0].username}.`,
        String(approved.rows[0].id),
        req.ip,
        client.query.bind(client),
      );
      return { user: approved.rows[0] };
    });
    if (outcome.status) return res.status(outcome.status).json({ error: outcome.reason || 'User was not found.' });
    res.json({ message: 'Registration approved.', user: outcome.user });
  } catch (error) { next(error); }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const outcome = await withTransaction(async (client) => {
      const current = await client.query(
        'SELECT id, username, account_status FROM users WHERE id=$1 FOR UPDATE',
        [req.params.id],
      );
      if (!current.rowCount) return { status: 404 };
      if (current.rows[0].account_status !== 'PENDING') return { status: 409, reason: 'Only pending registrations can be rejected.' };
      const rejected = await client.query(
        `UPDATE users SET account_status='REJECTED', is_active=FALSE, updated_at=NOW()
         WHERE id=$1 RETURNING ${userFields}`,
        [req.params.id],
      );
      await audit(
        req.user.id,
        'registration_rejected',
        `Registration rejected for ${current.rows[0].username}.`,
        String(req.params.id),
        req.ip,
        client.query.bind(client),
      );
      return { user: rejected.rows[0] };
    });
    if (outcome.status) return res.status(outcome.status).json({ error: outcome.reason || 'User was not found.' });
    res.json({ message: 'Registration rejected.', user: outcome.user });
  } catch (error) { next(error); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const role = req.body.role;
    const isActive = req.body.is_active;
    if (role !== undefined && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (isActive !== undefined && typeof isActive !== 'boolean') return res.status(400).json({ error: 'is_active must be a boolean.' });
    if (role === undefined && isActive === undefined) return res.status(400).json({ error: 'Provide a role or account activation change.' });
    if (Number(req.params.id) === req.user.id && ((role !== undefined && role !== 'admin') || isActive === false)) {
      return res.status(400).json({ error: 'You cannot remove your own administrative access.' });
    }

    const outcome = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(7438201)');
      const selected = await client.query(
        `SELECT id, username, role, account_status, is_active FROM users WHERE id=$1 FOR UPDATE`,
        [req.params.id],
      );
      if (!selected.rowCount) return { status: 404 };
      const current = selected.rows[0];
      if (role !== undefined && current.account_status !== 'APPROVED') {
        return { status: 409, reason: 'Approve the registration before assigning a role.' };
      }
      if (isActive === true && current.account_status !== 'APPROVED') {
        return { status: 409, reason: 'Only approved accounts can be activated.' };
      }
      const removesAdmin = current.role === 'admin' && current.account_status === 'APPROVED' && current.is_active
        && ((role !== undefined && role !== 'admin') || isActive === false);
      if (removesAdmin) {
        const admins = await client.query(
          `SELECT COUNT(*)::int AS total FROM users
           WHERE role='admin' AND account_status='APPROVED' AND is_active=TRUE`,
        );
        if (admins.rows[0].total <= 1) return { status: 409, reason: 'The last active administrator cannot be demoted or deactivated.' };
      }

      const result = await client.query(
        `UPDATE users SET role=COALESCE($1, role), is_active=COALESCE($2, is_active), updated_at=NOW()
         WHERE id=$3 RETURNING ${userFields}`,
        [role ?? null, isActive ?? null, req.params.id],
      );
      const updated = result.rows[0];
      if (role !== undefined && role !== current.role) {
        await audit(
          req.user.id,
          'role_changed',
          `Role changed for ${current.username} from ${current.role} to ${updated.role}.`,
          String(updated.id),
          req.ip,
          client.query.bind(client),
        );
      }
      if (isActive !== undefined && isActive !== current.is_active) {
        const action = isActive ? 'account_activated' : 'account_deactivated';
        await audit(
          req.user.id,
          action,
          `Account ${isActive ? 'activated' : 'deactivated'} for ${current.username}.`,
          String(updated.id),
          req.ip,
          client.query.bind(client),
        );
      }
      return { user: updated };
    });
    if (outcome.status) return res.status(outcome.status).json({ error: outcome.reason || 'User was not found.' });
    res.json({ user: outcome.user });
  } catch (error) { next(error); }
});

module.exports = router;
