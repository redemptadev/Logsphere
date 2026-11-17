const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const { loginDenialMessage } = require('../utils/accountAccess');

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const result = await query(
      'SELECT id, full_name, email, username, role, account_status, is_active, is_verified FROM users WHERE id = $1',
      [payload.sub],
    );
    const user = result.rows[0];
    if (loginDenialMessage(user)) {
      return res.status(401).json({ error: 'This account cannot access the application.' });
    }
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session is invalid or expired. Please sign in again.' });
    }
    next(error);
  }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

module.exports = { requireAuth, allowRoles };
