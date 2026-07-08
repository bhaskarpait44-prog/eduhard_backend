'use strict';

const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { StaffAttendance, User, Teacher } = require('../models');
const { writeAuditLog } = require('../utils/writeAuditLog');

const TODAY = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── GET /api/staff-attendance/daily ─────────────────────────────────────────
exports.getDailyAttendance = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const date = req.query.date || TODAY();

    const [staff] = await sequelize.query(`
      WITH staff_list AS (
        SELECT id, name, email, role::text, employee_id, designation, department, school_id, is_active, is_deleted, 'user' as type
        FROM users
        WHERE role IN ('admin', 'staff', 'librarian', 'receptionist', 'accountant')
          AND school_id = :schoolId
          AND is_active = true
          AND is_deleted = false
        UNION ALL
        SELECT id, CONCAT(first_name, ' ', last_name) AS name, email, 'teacher' AS role, employee_id, designation, department, school_id, is_active, is_deleted, 'teacher' as type
        FROM teachers
        WHERE school_id = :schoolId
          AND is_active = true
          AND is_deleted = false
      )
      SELECT
        sl.id AS staff_id,
        sl.name,
        sl.email,
        sl.role,
        sl.employee_id,
        sl.designation,
        sl.department,
        sl.type,
        sa.id AS attendance_id,
        sa.status,
        sa.remarks
      FROM staff_list sl
      LEFT JOIN staff_attendance sa ON (
        (sl.type = 'user' AND sa.user_id = sl.id) OR
        (sl.type = 'teacher' AND sa.teacher_id = sl.id)
      ) AND sa.date = :date AND sa.school_id = :schoolId
      ORDER BY sl.name ASC;
    `, { replacements: { schoolId, date } });

    res.ok({
      date,
      staff: staff
    }, `${staff.length} staff member(s) loaded.`);
  } catch (err) { next(err); }
};

// ── POST /api/staff-attendance/bulk ─────────────────────────────────────────
exports.markBulk = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { date, records } = req.body;
    const schoolId = req.user.school_id;
    const markerId = req.user.id;

    if (!date || !Array.isArray(records) || records.length === 0) {
      return res.fail('Invalid request data. Date and records are required.');
    }

    // 1. Validate all staff members belong to this school
    const teacherIds = [...new Set(records.filter(r => r.type === 'teacher' && r.staff_id).map(r => Number(r.staff_id)))];
    const userIds = [...new Set(records.filter(r => r.type !== 'teacher' && r.staff_id).map(r => Number(r.staff_id)))];

    const validTeacherSet = new Set();
    const validUserSet = new Set();

    if (teacherIds.length > 0) {
      const validTeachers = await Teacher.findAll({
        where: { id: teacherIds, school_id: schoolId },
        attributes: ['id'],
        transaction
      });
      validTeachers.forEach(t => validTeacherSet.add(t.id));
    }

    if (userIds.length > 0) {
      const validUsers = await User.findAll({
        where: { 
          id: userIds, 
          school_id: schoolId,
          role: { [Op.in]: ['admin', 'staff', 'librarian', 'receptionist', 'accountant'] }
        },
        attributes: ['id'],
        transaction
      });
      validUsers.forEach(u => validUserSet.add(u.id));
    }

    // 2. Fetch existing attendance records for these staff on this date
    const orConditions = [];
    if (teacherIds.length > 0) orConditions.push({ teacher_id: teacherIds });
    if (userIds.length > 0) orConditions.push({ user_id: userIds });

    let existingRecords = [];
    if (orConditions.length > 0) {
      existingRecords = await StaffAttendance.findAll({
        where: {
          school_id: schoolId,
          date,
          [Op.or]: orConditions
        },
        transaction
      });
    }

    const existingMap = new Map();
    existingRecords.forEach(r => {
      const key = r.teacher_id ? `teacher_${r.teacher_id}` : `user_${r.user_id}`;
      existingMap.set(key, r);
    });

    const inserted = [];
    const updated = [];

    for (const rec of records) {
      const isTeacher = rec.type === 'teacher';
      const staffId = Number(rec.staff_id);
      
      // Security: Skip if staff member doesn't belong to this school or has wrong role
      if (isTeacher && !validTeacherSet.has(staffId)) continue;
      if (!isTeacher && !validUserSet.has(staffId)) continue;

      const key = isTeacher ? `teacher_${staffId}` : `user_${staffId}`;
      const existing = existingMap.get(key);
      const idField = isTeacher ? 'teacher_id' : 'user_id';

      if (existing) {
        const oldStatus = existing.status;
        const oldRemarks = existing.remarks;
        const newStatus = rec.status;
        const newRemarks = rec.remarks || null;

        if (oldStatus !== newStatus || oldRemarks !== newRemarks) {
          await existing.update({
            status: newStatus,
            remarks: newRemarks
          }, { transaction });

          const changes = [];
          if (oldStatus !== newStatus) changes.push({ field: 'status', oldValue: oldStatus, newValue: newStatus });
          if (oldRemarks !== newRemarks) changes.push({ field: 'remarks', oldValue: oldRemarks, newValue: newRemarks });

          if (changes.length > 0) {
            await writeAuditLog(sequelize, {
              tableName: 'staff_attendance',
              recordId: existing.id,
              schoolId: schoolId,
              changes: changes,
              changedBy: markerId,
              reason: 'Bulk staff attendance update',
              ipAddress: req.ip,
              deviceInfo: req.headers['user-agent']
            }, transaction);
          }

          updated.push(staffId);
        }
      } else {
        const created = await StaffAttendance.create({
          school_id: schoolId,
          [idField]: staffId,
          date,
          status: rec.status,
          remarks: rec.remarks || null,
          created_by: markerId
        }, { transaction });

        await writeAuditLog(sequelize, {
          tableName: 'staff_attendance',
          recordId: created.id,
          schoolId: schoolId,
          changes: [
            { field: 'status', oldValue: null, newValue: rec.status },
            { field: 'remarks', oldValue: null, newValue: rec.remarks || null }
          ],
          changedBy: markerId,
          reason: 'Bulk staff attendance creation',
          ipAddress: req.ip,
          deviceInfo: req.headers['user-agent']
        }, transaction);

        inserted.push(staffId);
      }
    }

    await transaction.commit();
    res.ok({
      date,
      marked: inserted.length,
      updated: updated.length
    }, `Attendance saved. ${inserted.length} marked, ${updated.length} updated.`);
  } catch (err) {
    if (transaction) await transaction.rollback();
    next(err);
  }
};

// ── GET /api/staff-attendance/register ──────────────────────────────────────
exports.getMonthlyRegister = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);

    if (!month || !year) return res.fail('Month and year are required.');

    const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const toDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [rows] = await sequelize.query(`
      WITH staff_list AS (
        SELECT id, name, role::text, employee_id, school_id, is_active, is_deleted, 'user' as type
        FROM users
        WHERE role IN ('admin','staff','librarian','receptionist','accountant')
          AND school_id = :schoolId
          AND is_active = true
          AND is_deleted = false
        UNION ALL
        SELECT id, CONCAT(first_name,' ',last_name) AS name, 'teacher' AS role, employee_id, school_id, is_active, is_deleted, 'teacher' as type
        FROM teachers
        WHERE school_id = :schoolId
          AND is_active = true
          AND is_deleted = false
      )
      SELECT
        sl.id AS staff_id,
        sl.name,
        sl.role,
        sl.employee_id,
        sl.type,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'date', sa.date,
              'status', sa.status
            ) ORDER BY sa.date
          ) FILTER (WHERE sa.id IS NOT NULL),
          '[]'::json
        ) AS records
      FROM staff_list sl
      LEFT JOIN staff_attendance sa ON (
        (sl.type = 'user' AND sa.user_id = sl.id) OR
        (sl.type = 'teacher' AND sa.teacher_id = sl.id)
      ) AND sa.date BETWEEN :fromDate AND :toDate AND sa.school_id = :schoolId
      GROUP BY sl.id, sl.name, sl.role, sl.employee_id, sl.type
      ORDER BY sl.name ASC;
    `, { replacements: { schoolId, fromDate, toDate } });

    res.ok({
      month,
      year,
      staff: rows
    }, `Monthly register for ${month}/${year} retrieved.`);
  } catch (err) { next(err); }
};

// ── GET /api/staff-attendance/stats/:staff_id ────────────────────────────────
exports.getStaffSummary = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const staffId = Number(req.params.staff_id);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.fail('Invalid staff_id. Must be a positive integer.', [], 400);
    }
    const { from, to, type } = req.query; 

    if (!from || !to || !type) return res.fail('From date, to date, and staff type (user/teacher) are required.');

    const ALLOWED_COLUMNS = { teacher: 'teacher_id', user: 'user_id' };
    const idColumn = ALLOWED_COLUMNS[type];
    
    if (!idColumn) {
      return res.fail('Invalid staff type. Must be "teacher" or "user".', [], 400);
    }

    // Verify staff belongs to this school
    let staffExists = false;
    if (type === 'teacher') {
      staffExists = await Teacher.findOne({ where: { id: staffId, school_id: schoolId } });
    } else {
      staffExists = await User.findOne({ 
        where: { 
          id: staffId, 
          school_id: schoolId,
          role: { [Op.in]: ['admin', 'staff', 'librarian', 'receptionist', 'accountant'] }
        } 
      });
    }

    if (!staffExists) {
      return res.fail('Staff member not found or access denied.', [], 404);
    }

    const [stats] = await sequelize.query(`
      SELECT
        status,
        COUNT(*)::int AS count
      FROM staff_attendance
      WHERE ${idColumn} = :staffId
        AND school_id = :schoolId
        ${from && to ? 'AND date BETWEEN :from AND :to' : ''}
      GROUP BY status;
    `, { replacements: { staffId, schoolId, from, to } });

    const [records] = await sequelize.query(`
      SELECT date, status, remarks, created_at
      FROM staff_attendance
      WHERE ${idColumn} = :staffId
        AND school_id = :schoolId
        ${from && to ? 'AND date BETWEEN :from AND :to' : ''}
      ORDER BY date DESC
      LIMIT 100;
    `, { replacements: { staffId, schoolId, from, to } });

    res.ok({
      stats,
      records
    }, 'Staff attendance summary retrieved.');
  } catch (err) { next(err); }
};

