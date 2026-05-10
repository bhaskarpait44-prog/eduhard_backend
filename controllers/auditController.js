'use strict';

const sequelize = require('../config/database');

exports.getLogs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 30,
      from,
      to,
      admin_id,
      table_name,
      record_id,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 30, 1);
    const offset = (pageNum - 1) * limitNum;

    const replacements = {
      schoolId: req.user.school_id,
      from: from || null,
      to: to || null,
      admin_id: admin_id || null,
      table_name: table_name || null,
      record_id: record_id || null,
      limit: limitNum,
      offset,
    };

    const whereClause = `
      EXISTS (
        SELECT 1
        FROM users u_scope
        WHERE u_scope.id = al.changed_by
          AND u_scope.school_id = :schoolId
      )
      AND (:from IS NULL OR al.created_at >= CAST(:from AS TIMESTAMP))
      AND (:to IS NULL OR al.created_at < CAST(:to AS TIMESTAMP) + INTERVAL '1 day')
      AND (:admin_id IS NULL OR al.changed_by = CAST(:admin_id AS INTEGER))
      AND (:table_name IS NULL OR al.table_name = :table_name)
      AND (:record_id IS NULL OR al.record_id = CAST(:record_id AS INTEGER))
    `;

    const [[{ total }]] = await sequelize.query(`
      SELECT COUNT(*)::int AS total
      FROM audit_logs al
      WHERE ${whereClause};
    `, { replacements });

    const [logs] = await sequelize.query(`
      SELECT
        al.id,
        al.table_name,
        al.record_id,
        al.field_name,
        al.old_value,
        al.new_value,
        al.reason,
        al.ip_address,
        al.device_info,
        al.changed_by,
        al.created_at,
        u.name AS changed_by_name,
        u.email AS changed_by_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.changed_by
      WHERE ${whereClause}
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT :limit OFFSET :offset;
    `, { replacements });

    res.ok({
      logs,
      total,
      meta: {
        page: pageNum,
        perPage: limitNum,
        total,
        totalPages: Math.max(Math.ceil(total / limitNum), 1),
      },
    }, `${logs.length} audit log(s) retrieved.`);
  } catch (err) { next(err); }
};

exports.getDetail = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[log]] = await sequelize.query(`
      SELECT
        al.id,
        al.table_name,
        al.record_id,
        al.field_name,
        al.old_value,
        al.new_value,
        al.reason,
        al.ip_address,
        al.device_info,
        al.changed_by,
        al.created_at,
        u.name AS changed_by_name,
        u.email AS changed_by_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.changed_by
      WHERE al.id = :id
        AND EXISTS (
          SELECT 1
          FROM users u_scope
          WHERE u_scope.id = al.changed_by
            AND u_scope.school_id = :schoolId
        )
      LIMIT 1;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!log) return res.fail('Audit log not found.', [], 404);
    res.ok(log, 'Audit log detail retrieved.');
  } catch (err) { next(err); }
};

exports.getAdmins = async (req, res, next) => {
  try {
    const [users] = await sequelize.query(`
      SELECT id, name, email, role
      FROM users
      WHERE school_id = :schoolId
        AND role IN ('admin', 'teacher')
        AND is_active = true
      ORDER BY name ASC;
    `, { replacements: { schoolId: req.user.school_id } });

    res.ok({ users }, `${users.length} admin user(s) retrieved.`);
  } catch (err) { next(err); }
};

exports.getHistory = async (req, res, next) => {
  try {
    const { table, record_id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const [logs] = await sequelize.query(`
      SELECT al.id, al.field_name, al.old_value, al.new_value,
             al.reason, al.ip_address, al.device_info, al.created_at,
             u.name AS changed_by_name, u.email AS changed_by_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.changed_by
      WHERE al.table_name = :table AND al.record_id = :record_id
      ORDER BY al.created_at DESC
      LIMIT :limit OFFSET :offset;
    `, { replacements: { table, record_id, limit: parseInt(limit), offset: parseInt(offset) } });

    res.ok({ table, record_id, total: logs.length, logs }, `${logs.length} audit log(s) retrieved.`);
  } catch (err) { next(err); }
};

exports.getByAdmin = async (req, res, next) => {
  try {
    const { admin_id } = req.params;
    const { from, to, limit = 100 } = req.query;

    const [logs] = await sequelize.query(`
      SELECT al.id, al.table_name, al.record_id, al.field_name,
             al.old_value, al.new_value, al.reason, al.ip_address, al.device_info,
             al.changed_by, al.created_at, u.name AS changed_by_name, u.email AS changed_by_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.changed_by
      WHERE al.changed_by = :admin_id
        AND EXISTS (
          SELECT 1
          FROM users u_scope
          WHERE u_scope.id = al.changed_by
            AND u_scope.school_id = :schoolId
        )
        AND (:from IS NULL OR al.created_at >= CAST(:from AS TIMESTAMP))
        AND (:to IS NULL OR al.created_at < CAST(:to AS TIMESTAMP) + INTERVAL '1 day')
      ORDER BY al.created_at DESC
      LIMIT :limit;
    `, {
      replacements: {
        admin_id,
        schoolId: req.user.school_id,
        from: from || null,
        to: to || null,
        limit: parseInt(limit, 10),
      },
    });

    res.ok({ admin_id, total: logs.length, logs }, `${logs.length} change(s) by this admin.`);
  } catch (err) { next(err); }
};
