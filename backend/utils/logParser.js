const path = require('path');
const { validateLog } = require('./validation');

const MAX_RECORDS = 10000;
const MAX_REJECTION_DETAILS = 100;
const ALIASES = {
  id: 'log_id',
  logid: 'log_id',
  date: 'timestamp',
  time: 'timestamp',
  datetime: 'timestamp',
  created_at: 'timestamp',
  level: 'severity',
  service: 'service_name',
  host: 'source',
  hostname: 'source',
  ip: 'ip_address',
  status: 'http_status',
};

function csvFields(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        value += char;
      }
    } else if (char === ',') {
      fields.push(value.trim());
      value = '';
      closedQuote = false;
    } else if (char === '"') {
      if (value.trim() || closedQuote) throw new Error('CSV row contains a misplaced quote.');
      quoted = true;
    } else {
      if (closedQuote && !/\s/.test(char)) throw new Error('CSV row has text after a closing quote.');
      value += char;
    }
  }
  if (quoted) throw new Error('CSV row contains an unclosed quoted field.');
  fields.push(value.trim());
  return fields;
}

function normalizeHeader(header) {
  const normalized = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[normalized] || normalized;
}

function forEachLine(text, callback) {
  let start = 0;
  let lineNumber = 1;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text.charCodeAt(index) !== 10) continue;
    let end = index;
    if (end > start && text.charCodeAt(end - 1) === 13) end -= 1;
    callback(text.slice(start, end), lineNumber);
    start = index + 1;
    lineNumber += 1;
  }
}

function parseUpload(buffer, originalName) {
  const extension = path.extname(String(originalName || '')).toLowerCase();
  const result = {
    accepted: [],
    rejected: 0,
    total_records: 0,
    rejected_details: [],
    rejection_reasons: [],
  };
  const reasonCounts = new Map();
  const knownIds = new Set();
  const addRejected = (line, reason, count = 1) => {
    result.rejected += count;
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + count);
    if (result.rejected_details.length < MAX_REJECTION_DETAILS) {
      result.rejected_details.push({ line, reason, count });
    }
  };
  const addFileIssue = (reason) => {
    reasonCounts.set(reason, 0);
    result.rejected_details.push({ line: null, reason, count: 0, scope: 'file' });
  };
  const addRecord = (record, line) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      addRejected(line, 'Record must be a JSON object.');
      return;
    }
    const item = { ...record };
    item.log_id = item.log_id == null ? '' : String(item.log_id).trim();
    item.timestamp = item.timestamp || item.time || item.date || item.datetime || item.created_at;
    item.severity = item.severity || item.level;
    item.service_name = item.service_name || item.service;
    item.source = item.source || item.host || item.hostname;
    item.ip_address = item.ip_address || item.ip;
    item.http_status = item.http_status || item.status;

    if (!item.timestamp) {
      addRejected(line, 'Timestamp is required.');
      return;
    }
    if (item.log_id.length > 80) {
      addRejected(line, 'Log ID must be 80 characters or fewer.');
      return;
    }
    if (item.log_id && knownIds.has(item.log_id)) {
      addRejected(line, `Duplicate log ID in file: ${item.log_id}.`);
      return;
    }
    const validated = validateLog(item);
    if (validated.errors.length) {
      addRejected(line, validated.errors.join(' '));
      return;
    }
    if (item.log_id) knownIds.add(item.log_id);
    result.accepted.push({ ...validated.value, log_id: item.log_id || null, source_line: line });
  };

  if (!['.log', '.txt', '.csv'].includes(extension)) {
    addFileIssue('Unsupported file format. Use .log, .txt, or .csv.');
    result.rejection_reasons = [...reasonCounts].map(([reason, count]) => ({ reason, count }));
    return result;
  }
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8').replace(/^\uFEFF/, '') : '';
  if (!text.trim()) {
    addFileIssue('The uploaded file is empty.');
    result.rejection_reasons = [...reasonCounts].map(([reason, count]) => ({ reason, count }));
    return result;
  }

  if (extension === '.csv') {
    const headerEnd = text.indexOf('\n');
    let headerLine = headerEnd < 0 ? text : text.slice(0, headerEnd);
    if (headerLine.endsWith('\r')) headerLine = headerLine.slice(0, -1);
    let headers;
    try {
      headers = csvFields(headerLine).map(normalizeHeader);
    } catch (error) {
      let total = 0;
      let excess = 0;
      let firstExcessLine;
      forEachLine(text, (line, number) => {
        if (number === 1 || !line.trim()) return;
        total += 1;
        if (total <= MAX_RECORDS) addRejected(number, `Invalid CSV header: ${error.message}`);
        else {
          excess += 1;
          firstExcessLine = firstExcessLine || number;
        }
      });
      result.total_records = total;
      if (excess) addRejected(firstExcessLine, 'Upload exceeds the 10,000-record limit.', excess);
      if (!total) addFileIssue(`Invalid CSV header: ${error.message}`);
      result.rejection_reasons = [...reasonCounts].map(([reason, count]) => ({ reason, count }));
      return result;
    }
    const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
    const required = ['timestamp', 'severity', 'service_name', 'message'];
    const missing = required.filter((header) => !headers.includes(header));
    const headerError = duplicateHeaders.length
      ? 'CSV contains duplicate column names.'
      : missing.length
        ? `CSV is missing required columns: ${missing.join(', ')}.`
        : null;
    let excess = 0;
    let firstExcessLine;
    forEachLine(text, (line, number) => {
      if (number === 1 || !line.trim()) return;
      result.total_records += 1;
      if (result.total_records > MAX_RECORDS) {
        excess += 1;
        firstExcessLine = firstExcessLine || number;
        return;
      }
      if (headerError) {
        addRejected(number, headerError);
        return;
      }
      try {
        const values = csvFields(line);
        if (values.length !== headers.length) {
          addRejected(number, `CSV row has ${values.length} fields; expected ${headers.length}.`);
          return;
        }
        const item = Object.fromEntries(headers.map((key, fieldIndex) => [key, values[fieldIndex]]));
        if (item.metadata) {
          try { item.metadata = JSON.parse(item.metadata); } catch {
            addRejected(number, 'Metadata must contain valid JSON.');
            return;
          }
        }
        addRecord(item, number);
      } catch (error) {
        addRejected(number, error.message);
      }
    });
    if (excess) addRejected(firstExcessLine, 'Upload exceeds the 10,000-record limit.', excess);
    if (!result.total_records) addFileIssue(headerError || 'CSV contains no data records.');
  } else {
    let excess = 0;
    let firstExcessLine;
    forEachLine(text, (rawLine, number) => {
      const line = rawLine.trim();
      if (!line) return;
      result.total_records += 1;
      if (result.total_records > MAX_RECORDS) {
        excess += 1;
        firstExcessLine = firstExcessLine || number;
        return;
      }
      try {
        let item;
        if (line.startsWith('{')) {
          item = JSON.parse(line);
        } else {
          const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+([^:\s]+)[:\s]+(.*)$/i)
            || line.match(/^(\S+\s+\S+)\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+([^:\s]+)[:\s]+(.*)$/i);
          if (!match) {
            addRejected(number, 'Line does not match the supported timestamp severity service: message format or JSON log format.');
            return;
          }
          item = { timestamp: match[1], severity: match[2], service_name: match[3], message: match[4] };
        }
        addRecord(item, number);
      } catch (error) {
        addRejected(number, error instanceof SyntaxError ? 'Line contains invalid JSON.' : error.message);
      }
    });
    if (excess) addRejected(firstExcessLine, 'Upload exceeds the 10,000-record limit.', excess);
    if (!result.total_records) addFileIssue('File contains no log records.');
  }
  result.rejection_reasons = [...reasonCounts].map(([reason, count]) => ({ reason, count }));
  return result;
}

module.exports = { parseUpload };
