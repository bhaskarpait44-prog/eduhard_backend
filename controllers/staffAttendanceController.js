'use strict';

const sequelize = require('../config/database');
const { StaffAttendance, User } = require('../models');

const TODAY = () => new Date().toISOString().slice(0, 10);

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
        UNION ALL
        SELECT id, CONCAT(first_name, ' ', last_name) AS name, email, 'teacher' AS role, employee_id, designation, department, school_id, is_active, is_deleted, 'teacher' as type
        FROM teachers
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
      ) AND sa.date = :date
      WHERE sl.school_id = :schoolId
        AND sl.is_active = true
        AND sl.is_deleted = false
      ORDER BY sl.name ASC;
    `, { replacements: { schoolId, date } });

    res.ok({
      date,
      staff: staff.map(s => ({
        ...s,
        status: s.status || 'present'
      }))
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

    const inserted = [];
    const updated = [];

    for (const rec of records) {
      const idColumn = rec.type === 'teacher' ? 'teacher_id' : 'user_id';
      
      const [[existing]] = await sequelize.query(`
        SELECT id FROM staff_attendance 
        WHERE ${idColumn} = :staffId AND date = :date AND school_id = :schoolId;
      `, { replacements: { staffId: rec.staff_id, date, schoolId }, transaction });

      if (existing) {
        await sequelize.query(`
          UPDATE staff_attendance
          SET status = :status,
              remarks = :remarks,
              created_by = :markerId,
              updated_at = NOW()
          WHERE id = :id;
        `, {
          replacements: {
            id: existing.id,
            status: rec.status,
            remarks: rec.remarks || null,
            markerId
          },
          transaction
        });
        updated.push(rec.staff_id);
      } else {
        await sequelize.query(`
          INSERT INTO staff_attendance (school_id, ${idColumn}, date, status, remarks, created_by, created_at, updated_at)
          VALUES (:schoolId, :staffId, :date, :status, :remarks, :markerId, NOW(), NOW());
        `, {
          replacements: {
            schoolId,
            staffId: rec.staff_id,
            date,
            status: rec.status,
            remarks: rec.remarks || null,
            markerId
          },
          transaction
        });
        inserted.push(rec.staff_id);
      }
    }

    await transaction.commit();
    res.ok({
      date,
      marked: inserted.length,
      updated: updated.length
    }, `Attendance saved. ${inserted.length} marked, ${updated.length} updated.`);
  } catch (err) {
    await transaction.rollback();
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
        UNION ALL
        SELECT id, CONCAT(first_name,' ',last_name) AS name, 'teacher' AS role, employee_id, school_id, is_active, is_deleted, 'teacher' as type
        FROM teachers
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
      ) AND sa.date BETWEEN :fromDate AND :toDate
      WHERE sl.school_id = :schoolId
        AND sl.is_active = true
        AND sl.is_deleted = false
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

// ── GET /api/staff-attendance/stats/:user_id ────────────────────────────────
exports.getStaffSummary = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const staffId = req.params.user_id; // Frontend might still send user_id as param
    const { from, to, type } = req.query; // type is required now

    if (!type) return res.fail('Staff type is required.');

    const idColumn = type === 'teacher' ? 'teacher_id' : 'user_id';

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
