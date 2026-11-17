const SEVERITIES = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
const { isIP } = require('net');

function validateLog(body) {
  const errors = [];
  const severity = String(body.severity || '').toUpperCase();
  const serviceName = String(body.service_name || '').trim();
  const source = String(body.source || '').trim();
  const ipAddress = String(body.ip_address || '').trim();
  const message = String(body.message || '').trim();
  if (!SEVERITIES.includes(severity)) errors.push('Select a valid severity.');
  if (!serviceName || serviceName.length > 120) errors.push('Service name is required and must be 120 characters or fewer.');
  if (source.length > 150) errors.push('Source must be 150 characters or fewer.');
  if (ipAddress && !isIP(ipAddress)) errors.push('IP address must be a valid IPv4 or IPv6 address.');
  if (!message || message.length > 10000) errors.push('Message is required and must be 10,000 characters or fewer.');
  if (body.metadata != null && (typeof body.metadata !== 'object' || Array.isArray(body.metadata))) errors.push('Metadata must be a JSON object.');
  if (body.timestamp && Number.isNaN(Date.parse(body.timestamp))) errors.push('Timestamp is invalid.');
  const status = body.http_status === '' || body.http_status == null ? null : Number(body.http_status);
  if (status !== null && (!Number.isInteger(status) || status < 100 || status > 599)) errors.push('HTTP status must be between 100 and 599.');
  return {
    errors,
    value: {
      timestamp: body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString(),
      severity,
      service_name: serviceName,
      source: source || null,
      ip_address: ipAddress || null,
      http_status: status,
      message,
      metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
    },
  };
}

function passwordError(password) {
  if (typeof password !== 'string') return 'Password must be text.';
  if (password.length < 10) return 'Password must be at least 10 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be 72 UTF-8 bytes or fewer.';
  return null;
}

module.exports = { SEVERITIES, validateLog, passwordError };
