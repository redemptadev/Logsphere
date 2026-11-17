const express = require('express');
const { query } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, allowRoles('admin'));
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.id, a.action, a.description, a.entity_id, a.ip_address, a.created_at, u.username
       FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 500`,
    );
    res.json({ auditLogs: result.rows });
  } catch (error) { next(error); }
});
module.exports = router;
