'use strict';

/**
 * utils/auditLogger.js
 *
 * Sets PostgreSQL session variables before any student UPDATE.
 * The DB trigger fn_students_audit() reads these variables to
 * record WHO changed the record and WHY.
 *
 * Usage in controllers (Step 5+):
 *
 *   await auditLogger.setContext(sequelize, {
 *     changedBy : req.user.id,
 *     reason    : req.body.reason,
 *     ipAddress : req.ip,
 *     deviceInfo: req.headers['user-agent'],
 *   });
 *   await student.update({ first_name: 'New Name' });
 *
 * For manual/seed changes where no user is logged in, call with null changedBy.
 */

const auditLogger = {
  /**
   * Sets session-level variables that the Postgres trigger will read.
   * Must be called within the same DB connection/transaction as the UPDATE.
   *
   * @param {Sequelize} sequelize - the sequelize instance
   * @param {object}    ctx
   * @param {number|null} ctx.changedBy  - user id performing the change
   * @param {string}    ctx.reason       - human reason (min 10 chars, enforced here)
   * @param {string}    ctx.ipAddress    - request IP
   * @param {string}    ctx.deviceInfo   - user-agent string
   */
  async setContext(sequelize, { changedBy, reason, ipAddress, deviceInfo }) {
    // Validate reason length before touching the DB
    if (reason && reason.trim().length < 10) {
      throw new Error('Audit reason must be at least 10 characters.');
    }

    const safeReason     = (reason     || 'No reason provided').replace(/'/g, "''");
    const safeIp         = (ipAddress  || 'unknown').replace(/'/g, "''");
    const safeDevice     = (deviceInfo || 'unknown').replace(/'/g, "''").substring(0, 299);
    const safeChangedBy  = changedBy ? String(parseInt(changedBy, 10)) : 'NULL';

    // SET LOCAL — variables live only for the current transaction
    await sequelize.query(`
      SELECT
        set_config('app.changed_by',    '${safeChangedBy}', true),
        set_config('app.change_reason', '${safeReason}',    true),
        set_config('app.ip_address',    '${safeIp}',        true),
        set_config('app.device_info',   '${safeDevice}',    true);
    `);
  },

  /**
   * Fetch full audit trail for any record.
   * @param {Sequelize} sequelize
   * @param {string} tableName
   * @param {number} recordId
   */
  async getHistory(sequelize, tableName, recordId) {
    const [rows] = await sequelize.query(`
      SELECT
        al.id,
        al.field_name,
        al.old_value,
        al.new_value,
        al.reason,
        al.ip_address,
        al.device_info,
        al.changed_by,
        al.created_at
      FROM audit_logs al
      WHERE al.table_name = :tableName
        AND al.record_id  = :recordId
      ORDER BY al.created_at DESC;
    `, {
      replacements: { tableName, recordId },
    });
    return rows;
  },
};

module.exports = auditLogger;