const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const range = String(req.query.range || '7d');
    if (!['24h', '7d', '30d', 'custom'].includes(range)) return res.status(400).json({ error: 'Select a supported dashboard date range.' });
    let interval = '7 days';
    if (range === '24h') interval = '24 hours';
    if (range === '30d') interval = '30 days';
    if (range === 'custom') {
      const from = new Date(req.query.from);
      const to = new Date(req.query.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return res.status(400).json({ error: 'Provide a valid custom date range.' });
    }
    const dateClause = range === 'custom' ? 'timestamp >= $1 AND timestamp <= $2' : `timestamp >= NOW() - INTERVAL '${interval}'`;
    const dateValues = range === 'custom' ? [new Date(req.query.from).toISOString(), new Date(req.query.to).toISOString()] : [];
    const summary = await query(
      `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE severity='ERROR')::int AS errors,
       COUNT(*) FILTER (WHERE severity='CRITICAL')::int AS critical,
       COUNT(*) FILTER (WHERE severity='WARNING')::int AS warnings,
       COUNT(*) FILTER (WHERE severity='INFO')::int AS info,
       COUNT(*) FILTER (WHERE severity='DEBUG')::int AS debug
       FROM logs WHERE ${dateClause}`,
      dateValues,
    );
    const activity = await query(
      `SELECT date_trunc('day', timestamp) AS day, COUNT(*)::int AS total
       FROM logs WHERE ${dateClause} GROUP BY day ORDER BY day`,
      dateValues,
    );
    const recent = await query(
      `SELECT id, log_id, timestamp, severity, service_name, source, message
       FROM logs WHERE ${dateClause} ORDER BY timestamp DESC LIMIT 5`,
      dateValues,
    );
    res.json({
      ...summary.rows[0],
      activity: activity.rows,
      recentLogs: recent.rows,
      range,
    });
  } catch (error) { next(error); }
});

module.exports = router;
