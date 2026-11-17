const nodemailer = require('nodemailer');
const config = require('../config');

class EmailDeliveryError extends Error {
  constructor(message = 'Email delivery failed. Check the sender configuration in Brevo and try again.') {
    super(message);
    this.name = 'EmailDeliveryError';
    this.status = 502;
  }
}

function safeResponse(error) {
  return String(error.response || error.message || '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b\d{6}\b/g, '[code]')
    .replace(/(password|passwd|pass|credential|token|secret|auth(?:entication)?)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}

function logDeliveryFailure(error, info) {
  const responseCode = Number(error.responseCode || info?.responseCode) || undefined;
  const responseText = safeResponse(error);
  console.error('[email] SMTP delivery failed', {
    host: config.mail.host,
    port: config.mail.port,
    code: error.code || 'UNKNOWN',
    responseCode,
    command: error.command || undefined,
    response: responseText || undefined,
    acceptedCount: Array.isArray(info?.accepted) ? info.accepted.length : 0,
    rejectedCount: Array.isArray(info?.rejected) ? info.rejected.length : 0,
  });
  return responseCode;
}

async function sendMail({ to, subject, text }) {
  if (!config.mail.host || !Number.isInteger(config.mail.port) || config.mail.port < 1 || config.mail.port > 65535
    || !config.mail.user || !config.mail.pass || !config.mail.from) {
    const error = new Error('Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM.');
    error.name = 'EmailConfigurationError';
    error.status = 503;
    throw error;
  }

  const recipient = String(to || '').trim().toLowerCase();
  if (!recipient) {
    const error = new Error('A recipient email address is required.');
    error.status = 400;
    throw error;
  }

  const secure = config.mail.port === 465;
  try {
    const transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure,
      requireTLS: config.mail.port === 587,
      auth: { user: config.mail.user, pass: config.mail.pass },
    });
    const info = await transporter.sendMail({ from: config.mail.from, to: recipient, subject, text });
    const accepted = Array.isArray(info.accepted) && info.accepted.some((address) => {
      const value = typeof address === 'string' ? address : address?.address;
      return String(value || '').trim().toLowerCase() === recipient;
    });
    if (!accepted) {
      const error = new Error('SMTP provider did not accept the requested recipient.');
      error.code = 'ERECIPIENTREJECTED';
      error.responseCode = info.responseCode;
      error.command = 'DATA';
      error.response = info.response;
      throw error;
    }
    return info;
  } catch (error) {
    const responseCode = logDeliveryFailure(error);
    const message = responseCode === 554
      ? 'Brevo rejected the email (SMTP 554). Confirm MAIL_FROM is a verified sender in Brevo.'
      : 'The email provider did not accept the message. Check the SMTP configuration and try again.';
    throw new EmailDeliveryError(message);
  }
}

module.exports = sendMail;
