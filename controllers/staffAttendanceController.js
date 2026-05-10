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
      SELECT
        u.id AS user_id,
        u.name,
        u.email,
        u.role,
        u.employee_id,
        u.designation,
        u.department,
        sa.id AS attendance_id,
        sa.status,
        sa.remarks
      FROM users u
      LEFT JOIN staff_attendance sa ON sa.user_id = u.id AND sa.date = :date
      WHERE u.school_id = :schoolId
        AND u.is_active = true
        AND u.is_deleted = false
        AND u.role IN ('admin', 'staff', 'librarian', 'receptionist', 'accountant', 'teacher')
      ORDER BY u.name ASC;
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
      const [[existing]] = await sequelize.query(`
        SELECT id FROM staff_attendance 
        WHERE user_id = :userId AND date = :date AND school_id = :schoolId;
      `, { replacements: { userId: rec.user_id, date, schoolId }, transaction });

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
        updated.push(rec.user_id);
      } else {
        await sequelize.query(`
          INSERT INTO staff_attendance (school_id, user_id, date, status, remarks, created_by, created_at, updated_at)
          VALUES (:schoolId, :userId, :date, :status, :remarks, :markerId, NOW(), NOW());
        `, {
          replacements: {
            schoolId,
            userId: rec.user_id,
            date,
            status: rec.status,
            remarks: rec.remarks || null,
            markerId
          },
          transaction
        });
        inserted.push(rec.user_id);
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
      SELECT
        u.id AS user_id,
        u.name,
        u.role,
        u.employee_id,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'date', sa.date,
              'status', sa.status
            ) ORDER BY sa.date
          ) FILTER (WHERE sa.id IS NOT NULL),
          '[]'::json
        ) AS records
      FROM users u
      LEFT JOIN staff_attendance sa ON sa.user_id = u.id AND sa.date BETWEEN :fromDate AND :toDate
      WHERE u.school_id = :schoolId
        AND u.is_active = true
        AND u.is_deleted = false
        AND u.role IN ('admin', 'staff', 'librarian', 'receptionist', 'accountant', 'teacher')
      GROUP BY u.id, u.name, u.role, u.employee_id
      ORDER BY u.name ASC;
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
    const userId = req.params.user_id;
    const { from, to } = req.query;

    const [stats] = await sequelize.query(`
      SELECT
        status,
        COUNT(*)::int AS count
      FROM staff_attendance
      WHERE user_id = :userId
        AND school_id = :schoolId
        ${from && to ? 'AND date BETWEEN :from AND :to' : ''}
      GROUP BY status;
    `, { replacements: { userId, schoolId, from, to } });

    const [records] = await sequelize.query(`
      SELECT date, status, remarks, created_at
      FROM staff_attendance
      WHERE user_id = :userId
        AND school_id = :schoolId
        ${from && to ? 'AND date BETWEEN :from AND :to' : ''}
      ORDER BY date DESC
      LIMIT 100;
    `, { replacements: { userId, schoolId, from, to } });

    res.ok({
      stats,
      records
    }, 'Staff attendance summary retrieved.');
  } catch (err) { next(err); }
};
