'use strict';

/**
 * Writes one row per changed field to audit_logs.
 * Works for both single-field and multi-field updates.
 */
async function writeAuditLog(sequelize, {
  tableName,
  recordId,
  changes,     // [{ field, oldValue, newValue }] or single object
  changedBy,
  reason,
  ipAddress,
  deviceInfo,
}) {
  const rows = Array.isArray(changes) ? changes : [changes];
  const now  = new Date();

  const insertRows = rows.map(c => ({
    table_name  : tableName,
    record_id   : recordId,
    field_name  : c.field,
    old_value   : c.oldValue !== undefined ? String(c.oldValue ?? '') : null,
    new_value   : c.newValue !== undefined ? String(c.newValue ?? '') : null,
    changed_by  : changedBy  || null,
    reason      : reason     || null,
    ip_address  : ipAddress  || null,
    device_info : deviceInfo || null,
    created_at  : now,
  }));

  if (insertRows.length > 0) {
    await sequelize.getQueryInterface().bulkInsert('audit_logs', insertRows);
  }
}

/**
 * Compute which fields changed between oldRecord and newData.
 * Returns array of { field, oldValue, newValue } for changed fields only.
 */
function diffFields(oldRecord, newData, watchFields) {
  return watchFields
    .filter(field => {
      const oldVal = oldRecord[field];
      const newVal = newData[field];
      return newVal !== undefined && String(oldVal ?? '') !== String(newVal ?? '');
    })
    .map(field => ({
      field    : field,
      oldValue : oldRecord[field],
      newValue : newData[field],
    }));
}

module.exports = { writeAuditLog, diffFields };