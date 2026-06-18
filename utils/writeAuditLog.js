'use strict';

/**
 * Writes one row per changed field to audit_logs.
 * Works for both single-field and multi-field updates.
 */
async function writeAuditLog(sequelize, {
  tableName,
  recordId,
  schoolId,    // Added schoolId for multi-tenant isolation
  changes,     // [{ field, oldValue, newValue }] or single object
  changedBy,
  reason,
  ipAddress,
  deviceInfo,
}, transaction = null) {
  // Use provided reason or fallback if too short/missing
  const finalReason = (reason && reason.trim().length >= 10) 
    ? reason.trim() 
    : `Update to ${tableName} (reason omitted or too short)`;

  const rows = Array.isArray(changes) ? changes : [changes];
  const now  = new Date();

  const insertRows = rows.map(c => ({
    table_name  : tableName,
    record_id   : recordId,
    school_id   : schoolId   || null, // Store school_id directly in log
    field_name  : c.field,
    old_value   : c.oldValue !== undefined ? String(c.oldValue ?? '') : null,
    new_value   : c.newValue !== undefined ? String(c.newValue ?? '') : null,
    changed_by  : changedBy  || null,
    reason      : finalReason,
    ip_address  : ipAddress  || null,
    device_info : deviceInfo || null,
    created_at  : now,
  }));

  if (insertRows.length > 0) {
    await sequelize.getQueryInterface().bulkInsert('audit_logs', insertRows, { transaction });
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