const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../backend/config');
const database = require('../backend/db');

test('upload API enforces roles, stores valid logs, records rejection reasons, and refreshes reads', async (t) => {
  const originalQuery = database.query;
  const originalTransaction = database.withTransaction;
  const originalJwtSecret = config.jwtSecret;
  config.jwtSecret = 'upload-test-secret-with-more-than-thirty-two-characters';

  const users = new Map([
    [1, { id: 1, full_name: 'Admin User', email: 'admin@example.test', username: 'admin', role: 'admin', account_status: 'APPROVED', is_active: true, is_verified: true }],
    [2, { id: 2, full_name: 'Analyst User', email: 'analyst@example.test', username: 'analyst', role: 'analyst', account_status: 'APPROVED', is_active: true, is_verified: true }],
    [3, { id: 3, full_name: 'Viewer User', email: 'viewer@example.test', username: 'viewer', role: 'viewer', account_status: 'APPROVED', is_active: true, is_verified: true }],
  ]);
  const state = { logs: new Map(), files: [], audits: [], nextFileId: 1, nextLogId: 1 };
  database.query = async (sql, values = []) => {
    if (sql.includes('FROM users WHERE id = $1')) {
      const user = users.get(Number(values[0]));
      return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }
    if (sql.includes('FROM log_files f LEFT JOIN users')) {
      const files = state.files.slice().sort((a, b) => b.id - a.id).slice(0, 100).map((file) => ({
        ...file,
        uploaded_by: users.get(file.uploaded_by)?.username || null,
      }));
      return { rows: files, rowCount: files.length };
    }
    if (sql.includes('FROM logs l LEFT JOIN log_files')) {
      const log = [...state.logs.values()].find((item) => String(item.id) === String(values[0]) || item.log_id === String(values[0]));
      if (!log) return { rows: [], rowCount: 0 };
      const file = state.files.find((item) => item.id === log.file_id);
      return { rows: [{ ...log, upload_name: file?.original_name || null, uploaded_by: users.get(file?.uploaded_by)?.username || null }], rowCount: 1 };
    }
    if (sql.includes('COUNT(*) FILTER (WHERE severity=')) {
      const logs = [...state.logs.values()];
      return { rows: [{
        total: logs.length,
        errors: logs.filter((log) => log.severity === 'ERROR').length,
        critical: logs.filter((log) => log.severity === 'CRITICAL').length,
        warnings: logs.filter((log) => log.severity === 'WARNING').length,
        info: logs.filter((log) => log.severity === 'INFO').length,
        debug: logs.filter((log) => log.severity === 'DEBUG').length,
      }], rowCount: 1 };
    }
    if (sql.includes('date_trunc')) {
      const logs = [...state.logs.values()];
      return { rows: logs.length ? [{ day: logs[0].timestamp, total: logs.length }] : [], rowCount: logs.length ? 1 : 0 };
    }
    if (sql.includes('SELECT id, log_id, timestamp, severity, service_name, source, message')) {
      const logs = [...state.logs.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);
      return { rows: logs, rowCount: logs.length };
    }
    if (sql.includes('SELECT COUNT(*)::int AS total FROM logs')) {
      const search = String(values[0] || '').replace(/^%|%$/g, '').toLowerCase();
      const logs = [...state.logs.values()].filter((log) => !search
        || log.log_id.toLowerCase().includes(search)
        || log.message.toLowerCase().includes(search)
        || log.service_name.toLowerCase().includes(search)
        || String(log.source || '').toLowerCase().includes(search)
        || String(log.ip_address || '').toLowerCase().includes(search));
      return { rows: [{ total: logs.length }], rowCount: 1 };
    }
    if (sql.includes('FROM logs') && sql.includes('ORDER BY timestamp')) {
      const sort = sql.includes('timestamp ASC') ? 1 : -1;
      const limit = Number(values[values.length - 2]);
      const offset = Number(values[values.length - 1]);
      const search = String(values.find((value) => typeof value === 'string' && value.startsWith('%')) || '').replace(/^%|%$/g, '').toLowerCase();
      const logs = [...state.logs.values()]
        .filter((log) => !search || log.log_id.toLowerCase().includes(search) || log.message.toLowerCase().includes(search))
        .sort((a, b) => sort * (new Date(a.timestamp) - new Date(b.timestamp)));
      return { rows: logs.slice(offset, offset + limit), rowCount: Math.min(limit, Math.max(0, logs.length - offset)) };
    }
    throw new Error(`Unexpected mock database query: ${sql}`);
  };
  database.withTransaction = async (operation) => {
    const tx = {
      logs: new Map(state.logs),
      files: state.files.map((file) => ({ ...file })),
      audits: state.audits.slice(),
      nextFileId: state.nextFileId,
      nextLogId: state.nextLogId,
    };
    const client = {
      query: async (sql, values = []) => {
        if (sql.includes('INSERT INTO log_files')) {
          const file = {
            id: tx.nextFileId++,
            filename: values[0],
            original_name: values[1],
            uploaded_by: values[2],
            total_records: values[3],
            valid_records: 0,
            rejected_records: values[4],
            created_at: new Date().toISOString(),
          };
          tx.files.push(file);
          return { rows: [{ id: file.id }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO logs')) {
          const [log_id, timestamp, severity, service_name, source, ip_address, http_status, message, metadata, file_id] = values;
          if (tx.logs.has(log_id)) return { rows: [], rowCount: 0 };
          const log = {
            id: tx.nextLogId++, log_id, timestamp, severity, service_name, source, ip_address,
            http_status, message, metadata: JSON.parse(metadata), file_id,
          };
          tx.logs.set(log_id, log);
          return { rows: [{ id: log.id }], rowCount: 1 };
        }
        if (sql.includes('UPDATE log_files SET total_records')) {
          const [total, valid, rejected, id] = values;
          const file = tx.files.find((item) => item.id === id);
          Object.assign(file, { total_records: total, valid_records: valid, rejected_records: rejected });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          tx.audits.push(values);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected mock transaction query: ${sql}`);
      },
    };
    const result = await operation(client);
    state.logs = tx.logs;
    state.files = tx.files;
    state.audits = tx.audits;
    state.nextFileId = tx.nextFileId;
    state.nextLogId = tx.nextLogId;
    return result;
  };

  const app = require('../backend/index');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.pool.end();
    database.query = originalQuery;
    database.withTransaction = originalTransaction;
    config.jwtSecret = originalJwtSecret;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const tokenFor = (id) => jwt.sign({ sub: String(id) }, config.jwtSecret);
  const postFile = async (userId, name, contents) => {
    const form = new FormData();
    form.append('file', new Blob([contents]), name);
    return fetch(`${baseUrl}/logs/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenFor(userId)}` },
      body: form,
    });
  };

  const csv = [
    'log_id,timestamp,severity,service_name,message',
    'APP-ERR,2026-11-12T10:00:00Z,ERROR,API,Request failed',
    'APP-CRIT,2026-11-12T10:01:00Z,CRITICAL,Storage,Disk full',
    'APP-BAD,2026-11-12T10:02:00Z,INVALID,API,Bad severity',
  ].join('\n');
  const csvResponse = await postFile(1, 'batch.csv', csv);
  assert.equal(csvResponse.status, 201);
  const csvSummary = await csvResponse.json();
  assert.deepEqual(
    [csvSummary.total_records, csvSummary.imported_records, csvSummary.rejected_records],
    [3, 2, 1],
  );
  assert.match(csvSummary.rejection_reasons[0].reason, /severity/i);

  const txt = `${JSON.stringify({ timestamp: '2026-11-12T10:02:00Z', level: 'INFO', service: 'Web', message: 'Started' })}\n`;
  const txtResponse = await postFile(2, 'events.txt', txt);
  assert.equal(txtResponse.status, 201);
  assert.equal((await txtResponse.json()).imported_records, 1);
  const duplicateResponse = await postFile(2, 'events.txt', txt);
  assert.equal(duplicateResponse.status, 422);
  assert.equal((await duplicateResponse.json()).rejected_records, 1);

  const logResponse = await postFile(2, 'system.log', '2026-11-12T10:03:00Z DEBUG Worker: Verbose trace\n');
  assert.equal(logResponse.status, 201);
  assert.equal((await logResponse.json()).imported_records, 1);

  const viewerUpload = await postFile(3, 'blocked.csv', csv);
  assert.equal(viewerUpload.status, 403);
  const invalidFile = await postFile(2, 'invalid.json', '{}');
  assert.equal(invalidFile.status, 400);
  const emptyFile = await postFile(2, 'empty.txt', '');
  assert.equal(emptyFile.status, 422);
  assert.equal((await emptyFile.json()).total_records, 0);
  const oversizedFile = await postFile(2, 'oversized.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 32));
  assert.equal(oversizedFile.status, 413);

  const authorization = { authorization: `Bearer ${tokenFor(1)}` };
  const historyResponse = await fetch(`${baseUrl}/logs/files`, { headers: authorization });
  const history = await historyResponse.json();
  assert.equal(history.files.length, 5);
  assert.equal(history.files[0].original_name, 'empty.txt');
  assert.equal(history.files[0].uploaded_by, 'analyst');
  const csvHistory = history.files.find((file) => file.original_name === 'batch.csv');
  assert.deepEqual(
    [csvHistory.total_records, csvHistory.valid_records, csvHistory.rejected_records],
    [3, 2, 1],
  );

  const logsResponse = await fetch(`${baseUrl}/logs?search=APP-ERR&sort=asc`, { headers: authorization });
  const listedLogs = await logsResponse.json();
  assert.equal(listedLogs.total, 1);
  assert.equal(listedLogs.logs[0].log_id, 'APP-ERR');
  const sortedResponse = await fetch(`${baseUrl}/logs?sort=asc&limit=2`, { headers: authorization });
  const sortedLogs = await sortedResponse.json();
  assert.deepEqual(sortedLogs.logs.map((log) => log.log_id), ['APP-ERR', 'APP-CRIT']);

  const detailResponse = await fetch(`${baseUrl}/logs/APP-CRIT`, { headers: authorization });
  assert.equal((await detailResponse.json()).log.severity, 'CRITICAL');

  const dashboardResponse = await fetch(`${baseUrl}/dashboard?range=7d`, { headers: authorization });
  const dashboard = await dashboardResponse.json();
  assert.deepEqual(
    [dashboard.total, dashboard.errors, dashboard.critical, dashboard.info, dashboard.debug],
    [4, 1, 1, 1, 1],
  );
  assert.equal(dashboard.activity[0].total, 4);
  assert.ok(dashboard.recentLogs.some((log) => log.log_id === 'APP-CRIT'));
  assert.ok(state.audits.length >= 5);
});
