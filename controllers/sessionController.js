'use strict';

const sequelize = require('../config/database');
const { retroactiveHoliday } = require('../utils/attendanceCalculator');

// ── POST /api/sessions ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { name, start_date, end_date, working_days } = req.body;
    const schoolId = req.user.school_id;

    if (new Date(end_date) <= new Date(start_date)) {
      return res.fail('end_date must be after start_date.');
    }

    await sequelize.transaction(async (t) => {
      const [[session]] = await sequelize.query(`
        INSERT INTO sessions (school_id, name, start_date, end_date, status, is_current, created_by, created_at, updated_at)
        VALUES (:schoolId, :name, :start_date, :end_date, 'upcoming', false, :createdBy, NOW(), NOW())
        RETURNING id, name, start_date, end_date, status, is_current;
      `, { replacements: { schoolId, name, start_date, end_date, createdBy: req.user.id }, transaction: t });

      await sequelize.query(`
        INSERT INTO session_working_days
          (session_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday)
        VALUES
          (:sid, :mon, :tue, :wed, :thu, :fri, :sat, :sun);
      `, {
        replacements: {
          sid : session.id,
          mon : working_days.monday    ?? true,
          tue : working_days.tuesday   ?? true,
          wed : working_days.wednesday ?? true,
          thu : working_days.thursday  ?? true,
          fri : working_days.friday    ?? true,
          sat : working_days.saturday  ?? false,
          sun : working_days.sunday    ?? false,
        },
        transaction: t,
      });

      res.ok(session, 'Session created.', 201);
    });
  } catch (err) { next(err); }
};

// ── GET /api/sessions ────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const [sessions] = await sequelize.query(`
      SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current,
             wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
      FROM sessions s
      LEFT JOIN session_working_days wd ON wd.session_id = s.id
      WHERE s.school_id = :schoolId
      ORDER BY s.start_date DESC;
    `, { replacements: { schoolId: req.user.school_id } });

    res.ok(sessions, `${sessions.length} session(s) found.`);
  } catch (err) { next(err); }
};

// ── GET /api/sessions/current ────────────────────────────────────────────────
exports.getCurrent = async (req, res, next) => {
  try {
    const [[session]] = await sequelize.query(`
      SELECT s.*, wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday,
             COUNT(DISTINCT e.id) AS enrolled_students
      FROM sessions s
      LEFT JOIN session_working_days wd ON wd.session_id = s.id
      LEFT JOIN enrollments e ON e.session_id = s.id AND e.status = 'active'
      WHERE s.school_id = :schoolId AND s.is_current = true
      GROUP BY s.id, wd.id;
    `, { replacements: { schoolId: req.user.school_id } });

    if (!session) return res.ok(null, 'No active session found.');
    res.ok(session, 'Current session retrieved.');
  } catch (err) { next(err); }
};

// ── GET /api/sessions/:id ───────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[session]] = await sequelize.query(`
      SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current,
             wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
      FROM sessions s
      LEFT JOIN session_working_days wd ON wd.session_id = s.id
      WHERE s.id = :id AND s.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!session) return res.fail('Session not found.', [], 404);

    const [holidays] = await sequelize.query(`
      SELECT id, session_id, holiday_date, name, type
      FROM session_holidays
      WHERE session_id = :id
      ORDER BY holiday_date ASC, id ASC;
    `, { replacements: { id } });

    res.ok({ ...session, holidays }, 'Session retrieved.');
  } catch (err) { next(err); }
};

// ── PATCH /api/sessions/:id/activate ────────────────────────────────────────
exports.activate = async (req, res, next) => {
  try {
    const { id } = req.params;

    await sequelize.transaction(async (t) => {
      // Only one session can be current per school
      await sequelize.query(`
        UPDATE sessions SET is_current = false, status = 'closed', updated_at = NOW()
        WHERE school_id = :schoolId AND is_current = true;
      `, { replacements: { schoolId: req.user.school_id }, transaction: t });

      const [[session]] = await sequelize.query(`
        UPDATE sessions SET is_current = true, status = 'active', updated_at = NOW()
        WHERE id = :id AND school_id = :schoolId
        RETURNING id, name, status, is_current;
      `, { replacements: { id, schoolId: req.user.school_id }, transaction: t });

      if (!session) return res.fail('Session not found.', [], 404);
      res.ok(session, `Session "${session.name}" activated.`);
    });
  } catch (err) { next(err); }
};

// ── POST /api/sessions/:id/holidays ─────────────────────────────────────────
exports.addHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { holiday_date, name, type } = req.body;

    // Check if attendance already marked — retroactive if so
    const [[existingAttendance]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      WHERE e.session_id = :sessionId AND a.date = :date;
    `, { replacements: { sessionId: id, date: holiday_date } });

    // Insert holiday record
    await sequelize.query(`
      INSERT INTO session_holidays (session_id, holiday_date, name, type, added_by, created_at)
      VALUES (:sessionId, :date, :name, :type, :addedBy, NOW());
    `, { replacements: { sessionId: id, date: holiday_date, name, type, addedBy: req.user.id } });

    let retroResult = null;
    if (parseInt(existingAttendance.cnt, 10) > 0) {
      retroResult = await retroactiveHoliday(parseInt(id), holiday_date, name, req.user.id);
    }

    res.ok({
      holiday      : { session_id: id, holiday_date, name, type },
      retroactive  : retroResult,
    }, retroResult
      ? `Holiday added. ${retroResult.affectedCount} attendance record(s) updated retroactively.`
      : 'Holiday added.'
    , 201);
  } catch (err) { next(err); }
};

// ── GET /api/sessions/:id/holidays ──────────────────────────────────────────
exports.getHolidays = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [holidays] = await sequelize.query(`
      SELECT h.id, h.session_id, h.holiday_date, h.name, h.type
      FROM session_holidays h
      JOIN sessions s ON s.id = h.session_id
      WHERE h.session_id = :id AND s.school_id = :schoolId
      ORDER BY h.holiday_date ASC, h.id ASC;
    `, { replacements: { id, schoolId: req.user.school_id } });

    res.ok(holidays, `${holidays.length} holiday(s) found.`);
  } catch (err) { next(err); }
};
