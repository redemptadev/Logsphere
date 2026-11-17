const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { pool } = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.clientUrl, credentials: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) { next(error); }
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/users', require('./routes/users'));
app.use('/api/audit', require('./routes/audit'));

app.use((req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.name === 'EmailDeliveryError') {
    return res.status(error.status || 502).json({ error: error.message });
  }
  if (error.name === 'EmailConfigurationError') {
    return res.status(503).json({ error: 'Email delivery is not configured. Contact the administrator.' });
  }
  console.error(error);
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Log files must be 5 MB or smaller.' });
  if (error.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Only one log file can be uploaded at a time.' });
  if (error.code === '23505') return res.status(409).json({ error: 'A record with the same unique value already exists.' });
  if (error.code === '23503' || error.code === '23514') return res.status(400).json({ error: 'The submitted data is not valid for this operation.' });
  const status = Number(error.status || error.statusCode) || 500;
  res.status(status).json({ error: status < 500 ? error.message : 'The server could not complete the request.' });
});

async function start() {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters.');
  }
  if (!config.adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail)) {
    throw new Error('ADMIN_EMAIL must be configured with a valid administrator email address.');
  }
  
  app.listen(config.port, () => console.log(`LogSphere API listening on http://localhost:${config.port}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error('LogSphere API failed to start. Confirm PostgreSQL is running and .env is configured.', error.message);
    process.exitCode = 1;
  });
}

module.exports = app;
