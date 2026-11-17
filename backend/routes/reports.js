const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const audit = require('../utils/audit');
const { SEVERITIES } = require('../utils/validation');

const router = express.Router();
router.use(requireAuth);

function reportFilter(req) {
  const clauses = [];
  const values = [];
  const parsedDates = {};
  for (const key of ['from', 'to']) {
    if (!req.query[key]) continue;
    const date = new Date(req.query[key]);
    if (Number.isNaN(date.getTime())) {
      const error = new Error(`The ${key} date filter is invalid.`);
      error.status = 400;
      throw error;
    }
    parsedDates[key] = date;
  }
  if (parsedDates.from && parsedDates.to && parsedDates.from > parsedDates.to) {
    const error = new Error('The start date must be before the end date.');
    error.status = 400;
    throw error;
  }
  if (parsedDates.from) {
    values.push(parsedDates.from.toISOString());
    clauses.push(`timestamp >= $${values.length}`);
  }
  if (parsedDates.to) {
    values.push(parsedDates.to.toISOString());
    clauses.push(`timestamp <= $${values.length}`);
  }
  if (req.query.severity && !SEVERITIES.includes(String(req.query.severity).toUpperCase())) {
    const error = new Error('The severity filter is invalid.');
    error.status = 400;
    throw error;
  }
  if (req.query.severity) {
    values.push(String(req.query.severity).toUpperCase());
    clauses.push(`severity = $${values.length}`);
  }
  if (req.query.service) {
    if (String(req.query.service).length > 120) {
      const error = new Error('The service filter must be 120 characters or fewer.');
      error.status = 400;
      throw error;
    }
    values.push(String(req.query.service));
    clauses.push(`service_name = $${values.length}`);
  }
  if (req.query.search) {
    values.push(`%${String(req.query.search).slice(0, 200)}%`);
    const n = values.length;
    clauses.push(`(message ILIKE $${n} OR service_name ILIKE $${n} OR source ILIKE $${n} OR ip_address ILIKE $${n})`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

router.get('/', async (req, res, next) => {
  try {
    const { where, values } = reportFilter(req);
    const severity = await query(
      `SELECT severity, COUNT(*)::int AS total FROM logs ${where} GROUP BY severity ORDER BY severity`,
      values,
    );
    const activity = await query(
      `SELECT date_trunc('day', timestamp) AS day, COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE severity='ERROR')::int AS errors,
       COUNT(*) FILTER (WHERE severity='WARNING')::int AS warnings
       FROM logs ${where} GROUP BY day ORDER BY day`,
      values,
    );
    const sources = await query(
      `SELECT service_name, COUNT(*)::int AS total FROM logs ${where}
       GROUP BY service_name ORDER BY total DESC LIMIT 5`,
      values,
    );
    const count = await query(`SELECT COUNT(*)::int AS total FROM logs ${where}`, values);
    await audit(req.user.id, 'report_generated', 'Reports viewed.', null, req.ip);
    res.json({ total: count.rows[0].total, severity: severity.rows, activity: activity.rows, sources: sources.rows });
  } catch (error) { next(error); }
});

router.get('/export', async (req, res, next) => {
  try {
    const { where, values } = reportFilter(req);
    const result = await query(
      `SELECT log_id, timestamp, severity, service_name, source, ip_address, http_status, message
       FROM logs ${where} ORDER BY timestamp DESC`,
      values,
    );
    const columns = ['log_id', 'timestamp', 'severity', 'service_name', 'source', 'ip_address', 'http_status', 'message'];
    const csv = [
      columns.join(','),
      ...result.rows.map((row) => columns.map((field) => {
        let value = String(row[field] ?? '');
        if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
        return `"${value.replace(/"/g, '""')}"`;
      }).join(',')),
    ].join('\r\n');
    await audit(req.user.id, 'report_exported', `CSV report exported with ${result.rowCount} records.`, null, req.ip);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="logsphere-report.csv"');
    res.send(csv);
  } catch (error) { next(error); }
});

module.exports = router;
