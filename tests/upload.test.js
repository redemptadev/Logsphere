const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUpload } = require('../backend/routes/logs');
const { passwordError, validateLog } = require('../backend/utils/validation');

test('CSV import accepts valid records and counts malformed records', () => {
  const contents = [
    'timestamp,severity,service,message',
    '2026-11-12T10:00:00Z,ERROR,Database,"Connection failed, retrying"',
    'bad-time,BOGUS,API,Not valid',
  ].join('\n');
  const result = parseUpload(Buffer.from(contents), 'server.csv');
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].message, 'Connection failed, retrying');
  assert.equal(result.rejected, 1);
});

test('text log import rejects malformed lines without throwing', () => {
  const contents = [
    '2026-11-12 10:00:00 INFO API: Request completed',
    'unrecognised log text',
  ].join('\n');
  const result = parseUpload(Buffer.from(contents), 'server.log');
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].service_name, 'API');
  assert.equal(result.rejected, 1);
});

test('JSON log imports require a timestamp and accept the CRITICAL severity', () => {
  const contents = [
    JSON.stringify({ timestamp: '2026-11-12T10:00:00Z', level: 'CRITICAL', service: 'Storage', message: 'Disk full' }),
    JSON.stringify({ severity: 'INFO', service: 'API', message: 'Timestamp missing' }),
  ].join('\n');
  const result = parseUpload(Buffer.from(contents), 'server.log');
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].severity, 'CRITICAL');
  assert.equal(result.rejected, 1);
});

test('CSV import rejects malformed metadata instead of silently discarding it', () => {
  const contents = [
    'timestamp,severity,service,message,metadata',
    '2026-11-12T10:00:00Z,INFO,API,Request,{invalid}',
  ].join('\n');
  const result = parseUpload(Buffer.from(contents), 'server.csv');
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected, 1);
});

test('CSV import normalizes useful headers and retains an explicit log ID', () => {
  const contents = [
    'Log ID,Date,Level,Service Name,Host,IP Address,HTTP Status,Message,Metadata',
    'APP-42,2026-11-12T10:00:00Z,CRITICAL,Storage,node-4,192.168.10.4,503,"Volume full, writes paused","{""volume"":99}"',
  ].join('\n');
  const result = parseUpload(Buffer.from(contents), 'server.csv');
  assert.equal(result.total_records, 1);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].log_id, 'APP-42');
  assert.equal(result.accepted[0].severity, 'CRITICAL');
  assert.equal(result.accepted[0].metadata.volume, 99);
  assert.equal(result.rejected, 0);
});

test('duplicate IDs within an uploaded file are reported as rejected records', () => {
  const contents = [
    'log_id,timestamp,severity,service_name,message',
    'APP-1,2026-11-12T10:00:00Z,INFO,API,Started',
    'APP-1,2026-11-12T10:01:00Z,INFO,API,Repeated ID',
  ].join('\n');
  const result = parseUpload(Buffer.from(contents), 'server.csv');
  assert.equal(result.total_records, 2);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected, 1);
  assert.match(result.rejection_reasons[0].reason, /duplicate log ID/i);
});

test('malformed CSV rows and invalid log fields include rejection reasons and line numbers', () => {
  const contents = [
    'timestamp,severity,service_name,message',
    '2026-11-12T10:00:00Z,INFO,API,Valid',
    '2026-11-12T10:01:00Z,BOGUS,API,Invalid severity',
    '2026-11-12T10:02:00Z,INFO,API',
    'not-a-date,INFO,API,Invalid timestamp',
  ].join('\n');
  const result = parseUpload(Buffer.from(contents), 'server.csv');
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected, 3);
  assert.equal(result.rejected_details.length, 3);
  assert.ok(result.rejected_details.every((item) => item.line >= 3));
  assert.ok(result.rejection_reasons.length >= 2);
});

test('empty files and unsupported extensions produce explicit file-level reasons', () => {
  const empty = parseUpload(Buffer.from(' \r\n'), 'empty.txt');
  assert.equal(empty.total_records, 0);
  assert.equal(empty.rejected, 0);
  assert.match(empty.rejection_reasons[0].reason, /empty/i);
  const unsupported = parseUpload(Buffer.from('payload'), 'server.json');
  assert.equal(unsupported.accepted.length, 0);
  assert.match(unsupported.rejection_reasons[0].reason, /unsupported file format/i);
});

test('uploads enforce the documented record limit and count all excess records', () => {
  const record = '2026-11-12T10:00:00Z INFO API: Request completed';
  const contents = Array(10001).fill(record).join('\n');
  const result = parseUpload(Buffer.from(contents), 'large.txt');
  assert.equal(result.total_records, 10001);
  assert.equal(result.accepted.length, 10000);
  assert.equal(result.rejected, 1);
  assert.match(result.rejection_reasons[0].reason, /10,000-record limit/i);
});

test('log validation rejects invalid IP addresses and bcrypt-unsafe passwords', () => {
  const log = validateLog({ severity: 'INFO', service_name: 'API', message: 'Request', ip_address: '999.999.999.999' });
  assert.match(log.errors.join(' '), /valid IPv4 or IPv6/);
  assert.equal(passwordError('long-enough-password'), null);
  assert.match(passwordError('x'.repeat(73)), /72 UTF-8 bytes/);
});
