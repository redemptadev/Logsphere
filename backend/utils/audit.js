const { query } = require('../db');

async function audit(userId, action, description, entityId, ipAddress, execute = query) {
  await execute(
    `INSERT INTO audit_logs (user_id, action, description, entity_id, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId || null, action, description, entityId || null, ipAddress || null],
  );
}

module.exports = audit;
