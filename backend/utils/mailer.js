
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

function getBrevoSender(from) {
  const formatted = String(from).trim().match(/^(.*?)\s*<([^<>]+)>$/);

  if (!formatted) {
    return { email: String(from).trim() };
  }

  const name = formatted[1].trim().replace(/^["']|["']$/g, '');

  return name
    ? { name, email: formatted[2].trim() }
    : { email: formatted[2].trim() };
}

function safeErrorCode(error) {
  const code = error.name === 'AbortError'
    ? 'ETIMEDOUT'
    : error.code || error.name || 'UNKNOWN';

  return /^[a-z0-9_-]{1,40}$/i.test(code) ? code : 'UNKNOWN';
}

async function sendWithBrevoApi({ recipient, subject, text }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': config.mail.brevoApiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: getBrevoSender(config.mail.from),
        to: [{ email: recipient }],
        subject,
        textContent: text,
      }),
      signal: controller.signal,
    });

    let result;

    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok || !result?.messageId) {
      console.error('[email] Brevo API delivery failed', {
        status: response.status,
        code: result?.code || 'UNKNOWN',
        message: result?.message || 'No error message returned',
      });

      throw new EmailDeliveryError(
        'Brevo did not accept the email. Check the API key and verified sender.'
      );
    }

    return {
      accepted: [recipient],
      rejected: [],
      messageId: result.messageId,
      responseCode: response.status,
    };
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      throw error;
    }

    console.error('[email] Brevo API request failed', {
      code: safeErrorCode(error),
    });

    throw new EmailDeliveryError(
      'The Brevo API could not be reached. Try again later.'
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function sendMail({ to, subject, text }) {
  const smtpConfigured = config.mail.host
    && Number.isInteger(config.mail.port)
    && config.mail.port >= 1
    && config.mail.port <= 65535
    && config.mail.user
    && config.mail.pass;

  if (!config.mail.from || (!config.mail.brevoApiKey && !smtpConfigured)) {
    const error = new Error(
      'Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM.'
    );
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

  if (config.mail.brevoApiKey) {
    return sendWithBrevoApi({ recipient, subject, text });
  }

  const secure = config.mail.port === 465;

  try {
    const transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure,
      requireTLS: config.mail.port === 587,
      auth: {
        user: config.mail.user,
        pass: config.mail.pass,
      },
    });

    const info = await transporter.sendMail({
      from: config.mail.from,
      to: recipient,
      subject,
      text,
    });

    const accepted = Array.isArray(info.accepted)
      && info.accepted.some((address) => {
        const value = typeof address === 'string'
          ? address
          : address?.address;

        return String(value || '').trim().toLowerCase() === recipient;
      });

    if (!accepted) {
      const error = new Error(
        'SMTP provider did not accept the requested recipient.'
      );
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
