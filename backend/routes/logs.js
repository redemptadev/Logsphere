const express = require('express');
const multer = require('multer');
const { randomInt, createHmac, randomUUID, createHash } = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { query, withTransaction } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');
const { validateLog, SEVERITIES } = require('../utils/validation');
const { parseUpload } = require('../utils/logParser');
const audit = require('../utils/audit');
const config = require('../config');
const sendMail = require('../utils/mailer');

const router = express.Router();
const deletionLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (['.log', '.txt', '.csv'].includes(path.extname(file.originalname).toLowerCase())) return callback(null, true);
    const error = new Error('Only .log, .txt, and .csv files are supported.');
    error.status = 400;
    callback(error);
  },
});
const codeHash = (code) => createHmac('sha256', config.jwtSecret).update(code).digest('hex');
const selectFields = `id, log_id, timestamp, severity, service_name, source, ip_address,
  http_status, message, metadata, file_id, created_at, updated_at`;

function buildFilters(filters) {
  const clauses = [];
  const values = [];
  const parsedDates = {};
  for (const key of ['from', 'to']) {
    if (!filters[key]) continue;
    const date = new Date(filters[key]);
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
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace('?', `$${values.length}`));
  };
  if (filters.severity && !SEVERITIES.includes(String(filters.severity).toUpperCase())) {
    const error = new Error('The severity filter is invalid.');
    error.status = 400;
    throw error;
  }
  if (filters.severity) add('severity = ?', String(filters.severity).toUpperCase());
  if (filters.service && String(filters.service).length > 120) {
    const error = new Error('The service filter must be 120 characters or fewer.');
    error.status = 400;
    throw error;
  }
  if (filters.service) add('service_name = ?', String(filters.service));
  if (parsedDates.from) add('timestamp >= ?', parsedDates.from.toISOString());
  if (parsedDates.to) add('timestamp <= ?', parsedDates.to.toISOString());
  if (filters.search) {
    values.push(`%${String(filters.search).slice(0, 200)}%`);
    const n = values.length;
    clauses.push(`(log_id ILIKE $${n} OR message ILIKE $${n} OR service_name ILIKE $${n} OR source ILIKE $${n} OR ip_address ILIKE $${n})`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { where, values } = buildFilters(req.query);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const sort = String(req.query.sort || 'desc').toLowerCase();
    if (!['asc', 'desc'].includes(sort)) return res.status(400).json({ error: 'Sort order must be asc or desc.' });
    const result = await query(
      `SELECT ${selectFields} FROM logs ${where} ORDER BY timestamp ${sort.toUpperCase()}, id ${sort.toUpperCase()} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    const count = await query(`SELECT COUNT(*)::int AS total FROM logs ${where}`, values);
    res.json({ logs: result.rows, page, limit, total: count.rows[0].total });
  } catch (error) {
    next(error);
  }
});

router.get('/files', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT f.id, f.original_name, f.total_records, f.valid_records, f.rejected_records, f.created_at, u.username AS uploaded_by
       FROM log_files f LEFT JOIN users u ON u.id = f.uploaded_by ORDER BY f.created_at DESC LIMIT 100`,
    );
    res.json({ files: result.rows });
  } catch (error) { next(error); }
});

router.post('/upload', allowRoles('admin', 'analyst'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a supported log file to upload.' });
    const originalName = path.basename(req.file.originalname.replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '');
    if (!originalName || originalName.length > 255) return res.status(400).json({ error: 'Filename must be between 1 and 255 characters.' });
    const parsed = parseUpload(req.file.buffer, originalName);
    const reasonCounts = new Map(parsed.rejection_reasons.map(({ reason, count }) => [reason, count]));
    const rejectedDetails = parsed.rejected_details.slice();
    let importedRecords = 0;
    const fileId = await withTransaction(async (client) => {
      const fileResult = await client.query(
        `INSERT INTO log_files (filename, original_name, uploaded_by, total_records, valid_records, rejected_records)
         VALUES ($1, $2, $3, $4, 0, $5) RETURNING id`,
        [`upload-${randomUUID()}${path.extname(originalName).toLowerCase()}`, originalName, req.user.id, parsed.total_records, parsed.rejected],
      );
      const newFileId = fileResult.rows[0].id;
      const fingerprint = createHash('sha256').update(req.file.buffer).digest('hex');
      let duplicateRecords = 0;
      for (const log of parsed.accepted) {
        const logId = log.log_id || `IMP-${createHash('sha256').update(`${fingerprint}:${log.source_line}`).digest('hex').slice(0, 40)}`;
        const inserted = await client.query(
          `INSERT INTO logs (log_id, timestamp, severity, service_name, source, ip_address, http_status, message, metadata, file_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
           ON CONFLICT (log_id) DO NOTHING RETURNING id`,
          [logId, log.timestamp, log.severity, log.service_name, log.source, log.ip_address, log.http_status, log.message, JSON.stringify(log.metadata), newFileId],
        );
        if (inserted.rowCount) {
          importedRecords += 1;
        } else {
          duplicateRecords += 1;
          const reason = `Duplicate log ID already exists: ${logId}.`;
          reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
          if (rejectedDetails.length < 100) rejectedDetails.push({ line: log.source_line, reason, count: 1 });
        }
      }
      const rejectedRecords = parsed.rejected + duplicateRecords;
      await client.query(
        `UPDATE log_files SET total_records=$1, valid_records=$2, rejected_records=$3 WHERE id=$4`,
        [parsed.total_records, importedRecords, rejectedRecords, newFileId],
      );
      await audit(req.user.id, 'file_upload', `Imported ${importedRecords} records from ${originalName}; ${rejectedRecords} rejected.`, String(newFileId), req.ip, client.query.bind(client));
      return newFileId;
    });
    const rejectedRecords = parsed.rejected + (parsed.accepted.length - importedRecords);
    const summary = {
      file_id: fileId,
      message: importedRecords ? 'File processed.' : 'File processed, but no records were imported.',
      error: importedRecords ? undefined : 'The file was processed, but it contains no importable log records.',
      total_records: parsed.total_records,
      imported_records: importedRecords,
      rejected_records: rejectedRecords,
      rejection_reasons: [...reasonCounts].map(([reason, count]) => ({ reason, count })),
      rejected_details: rejectedDetails,
    };
    res.status(importedRecords ? 201 : 422).json(summary);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT l.*, f.original_name AS upload_name, u.username AS uploaded_by
       FROM logs l LEFT JOIN log_files f ON f.id = l.file_id LEFT JOIN users u ON u.id = f.uploaded_by
       WHERE l.id::text = $1 OR l.log_id = $1`,
      [req.params.id],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Log record was not found.' });
    res.json({ log: result.rows[0] });
  } catch (error) { next(error); }
});

router.post('/', allowRoles('admin', 'analyst'), async (req, res, next) => {
  try {
    const { errors, value } = validateLog(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const log = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO logs (log_id, timestamp, severity, service_name, source, ip_address, http_status, message, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING ${selectFields}`,
        [`LG-${randomUUID()}`, value.timestamp, value.severity, value.service_name, value.source, value.ip_address, value.http_status, value.message, JSON.stringify(value.metadata)],
      );
      await audit(req.user.id, 'log_created', 'Log record created.', String(result.rows[0].id), req.ip, client.query.bind(client));
      return result.rows[0];
    });
    res.status(201).json({ log });
  } catch (error) { next(error); }
});

router.put('/:id', allowRoles('admin', 'analyst'), async (req, res, next) => {
  try {
    const { errors, value } = validateLog(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const log = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE logs SET timestamp=$1, severity=$2, service_name=$3, source=$4, ip_address=$5,
         http_status=$6, message=$7, metadata=$8::jsonb, updated_at=NOW()
         WHERE id=$9 RETURNING ${selectFields}`,
        [value.timestamp, value.severity, value.service_name, value.source, value.ip_address, value.http_status, value.message, JSON.stringify(value.metadata), req.params.id],
      );
      if (!result.rowCount) return null;
      await audit(req.user.id, 'log_updated', 'Log record updated.', String(req.params.id), req.ip, client.query.bind(client));
      return result.rows[0];
    });
    if (!log) return res.status(404).json({ error: 'Log record was not found.' });
    res.json({ log });
  } catch (error) { next(error); }
});

router.post('/:id/deletion-request', allowRoles('admin'), deletionLimit, async (req, res, next) => {
  try {
    const exists = await query('SELECT log_id FROM logs WHERE id=$1', [req.params.id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Log record was not found.' });
    const code = String(randomInt(100000, 1000000));
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE deletion_confirmation_codes SET used_at=NOW()
         WHERE user_id=$1 AND entity_id=$2 AND used_at IS NULL`,
        [req.user.id, String(req.params.id)],
      );
      await client.query(
        `INSERT INTO deletion_confirmation_codes (user_id, admin_email, code, entity_id, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')`,
        [req.user.id, config.adminEmail, codeHash(code), String(req.params.id)],
      );
      await audit(req.user.id, 'log_deletion_requested', `Deletion requested for ${exists.rows[0].log_id}.`, String(req.params.id), req.ip, client.query.bind(client));
    });
    await sendMail({ to: config.adminEmail, subject: 'LogSphere log deletion confirmation', text: `Deletion code: ${code}. It expires in 10 minutes.` });
    res.json({ message: 'A confirmation code has been emailed to the configured administrator.' });
  } catch (error) { next(error); }
});

router.post('/:id/deletion-confirmation', allowRoles('admin'), deletionLimit, async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Enter the emailed confirmation code.' });
    const deleted = await withTransaction(async (client) => {
      const token = await client.query(
        `SELECT id FROM deletion_confirmation_codes
         WHERE user_id=$1 AND admin_email=$2 AND code=$3 AND used_at IS NULL AND expires_at>NOW()
         AND entity_id=$4 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [req.user.id, config.adminEmail, codeHash(code), String(req.params.id)],
      );
      if (!token.rowCount) return null;
      const log = await client.query('DELETE FROM logs WHERE id=$1 RETURNING id, log_id', [req.params.id]);
      if (!log.rowCount) return { notFound: true };
      await client.query('UPDATE deletion_confirmation_codes SET used_at=NOW() WHERE id=$1', [token.rows[0].id]);
      await audit(req.user.id, 'log_deleted', `Log ${log.rows[0].log_id} deleted after confirmation.`, String(log.rows[0].id), req.ip, client.query.bind(client));
      return log.rows[0];
    });
    if (!deleted) return res.status(400).json({ error: 'Confirmation code is invalid, expired, or already used.' });
    if (deleted.notFound) return res.status(404).json({ error: 'Log record was not found.' });
    res.json({ message: 'Log record deleted.' });
  } catch (error) { next(error); }
});

module.exports = router;
module.exports.parseUpload = parseUpload;
