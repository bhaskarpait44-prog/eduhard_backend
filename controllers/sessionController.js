'use strict';

const sequelize = require('../config/database');
const { retroactiveHoliday } = require('../utils/attendanceCalculator');
const { invalidateCache } = require('../middlewares/cache');

// ── POST /api/sessions ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { name, start_date, end_date, working_days } = req.body;
    const schoolId = req.user.school_id;

    if (new Date(end_date) <= new Date(start_date)) {
      return res.fail('end_date must be after start_date.');
    }

    await sequelize.transaction(async (t) => {
      // Check for overlapping sessions
      const [[overlap]] = await sequelize.query(`
        SELECT id FROM sessions
        WHERE school_id = :schoolId
          AND (start_date <= :end_date AND end_date >= :start_date)
        LIMIT 1;
      `, { replacements: { schoolId, start_date, end_date }, transaction: t });

      if (overlap) {
        return res.fail('This session dates overlap with an existing session.');
      }

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

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'created', 'none', 'exists',
           :userId, 'Session created by admin', :ip, :device, NOW());
      `, { replacements: {
        id: session.id,
        userId: req.user.id,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      res.ok(session, 'Session created.', 201);
      invalidateCache(schoolId, '/api/sessions*');
      invalidateCache(schoolId, '/api/dashboard*');
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError' || (err.parent && err.parent.code === '23505')) {
      return res.fail('A session with this name already exists for your school.');
    }
    next(err);
  }
};

// ── GET /api/sessions ────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const { search, status } = req.query;
    const offset = (page - 1) * limit;
    const schoolId = req.user.school_id;

    let whereClause = 'WHERE s.school_id = :schoolId';
    const replacements = { schoolId, limit, offset };

    if (search) {
      whereClause += ' AND s.name ILIKE :search';
      replacements.search = `%${search}%`;
    }

    if (status && status !== 'all') {
      whereClause += ' AND s.status = :status';
      replacements.status = status;
    }

    const [sessions] = await sequelize.query(`
      SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
             wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
      FROM sessions s
      LEFT JOIN session_working_days wd ON wd.session_id = s.id
      ${whereClause}
      ORDER BY s.start_date DESC
      LIMIT :limit OFFSET :offset;
    `, { replacements });

    const [[countRow]] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM sessions s 
      ${whereClause};
    `, { replacements });

    res.ok({
      sessions,
      pagination: {
        total: parseInt(countRow.count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(countRow.count, 10) / limit),
      }
    });
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
      SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
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
      // 1. Verify target session exists and belongs to this school
      const [[target]] = await sequelize.query(`
        SELECT id, status FROM sessions WHERE id = :id AND school_id = :schoolId LIMIT 1;
      `, { replacements: { id, schoolId: req.user.school_id }, transaction: t });

      if (!target) return res.fail('Session not found.', [], 404);
      if (target.status !== 'upcoming') {
        return res.fail(`Cannot activate a session that is ${target.status}. Only upcoming sessions can be activated.`);
      }

      // 2. Only one session can be current per school
      const [[current]] = await sequelize.query(`
        SELECT id, name FROM sessions WHERE school_id = :schoolId AND is_current = true;
      `, { replacements: { schoolId: req.user.school_id }, transaction: t });

      if (current) {
        await sequelize.query(`
          UPDATE sessions SET is_current = false, status = 'closed', updated_at = NOW()
          WHERE id = :id;
        `, { replacements: { id: current.id }, transaction: t });

        await sequelize.query(`
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('sessions', :id, 'status', 'active', 'closed',
             :userId, :reason, :ip, :device, NOW());
        `, { replacements: {
          id: current.id,
          userId: req.user.id,
          reason: `Session automatically closed upon activation of "${id}"`,
          ip: req.ip || null,
          device: (req.headers['user-agent'] || '').slice(0, 299)
        }, transaction: t });
      }

      await sequelize.query(`
        UPDATE sessions SET is_current = true, status = 'active', updated_at = NOW()
        WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId: req.user.school_id }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'status', 'upcoming', 'active',
           :userId, :reason, :ip, :device, NOW());
      `, { replacements: {
        id,
        userId: req.user.id,
        reason: `Session activated by admin`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      // Fetch refreshed session data to return
      const [[session]] = await sequelize.query(`
        SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
               wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
        FROM sessions s
        LEFT JOIN session_working_days wd ON wd.session_id = s.id
        WHERE s.id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { id, schoolId: req.user.school_id }, transaction: t });

      res.ok(session, `Session "${session.name}" activated.`);
      invalidateCache(req.user.school_id, '/api/sessions*');
      invalidateCache(req.user.school_id, '/api/dashboard*');
    });
  } catch (err) { next(err); }
};

// ── POST /api/sessions/:id/holidays ─────────────────────────────────────────
exports.addHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { holiday_date, name, type } = req.body;

    const result = await sequelize.transaction(async (t) => {
      // 1. Fetch session metadata for validation (Inside transaction)
      const [[session]] = await sequelize.query(`
        SELECT start_date, end_date, status, is_locked 
        FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId: req.user.school_id }, transaction: t });

      if (!session) {
        throw { name: 'CustomError', message: 'Session not found.', status: 404 };
      }

      if (session.is_locked || ['upcoming', 'locked', 'closed', 'archived'].includes(session.status)) {
        throw { name: 'CustomError', message: `Cannot add holiday: session is ${session.status}.`, status: 400 };
      }

      const hDate = new Date(holiday_date);
      if (hDate < new Date(session.start_date) || hDate > new Date(session.end_date)) {
        throw { name: 'CustomError', message: `Holiday date must be between session start (${session.start_date}) and end (${session.end_date}).`, status: 400 };
      }

      // 2. Check for duplicate holiday
      const [[duplicate]] = await sequelize.query(`
        SELECT id FROM session_holidays WHERE session_id = :sessionId AND holiday_date = :date LIMIT 1;
      `, { replacements: { sessionId: id, date: holiday_date }, transaction: t });

      if (duplicate) {
        throw { name: 'CustomError', message: 'A holiday already exists for this date in this session.', status: 400 };
      }

      // 3. Check if attendance already marked — retroactive if so
      const [[existingAttendance]] = await sequelize.query(`
        SELECT COUNT(*) AS cnt FROM attendance a
        JOIN enrollments e ON e.id = a.enrollment_id
        WHERE e.session_id = :sessionId AND a.date = :date;
      `, { replacements: { sessionId: id, date: holiday_date }, transaction: t });

      // Insert holiday record
      const [[newHoliday]] = await sequelize.query(`
        INSERT INTO session_holidays (session_id, holiday_date, name, type, added_by, created_at)
        VALUES (:sessionId, :date, :name, :type, :addedBy, NOW())
        RETURNING id;
      `, { replacements: { sessionId: id, date: holiday_date, name, type, addedBy: req.user.id }, transaction: t });

      let retroResult = null;
      if (parseInt(existingAttendance.cnt, 10) > 0) {
        retroResult = await retroactiveHoliday(parseInt(id), holiday_date, name, req.user.id, t);
      }

      // Audit log
      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, created_at)
        VALUES
          ('session_holidays', :id, 'holiday_added', 'none', :date,
           :userId, :reason, NOW());
      `, { replacements: {
        id: newHoliday.id,
        date: holiday_date,
        userId: req.user.id,
        reason: `Holiday "${name}" added to session`
      }, transaction: t });

      return {
        holiday      : { id: newHoliday.id, session_id: id, holiday_date, name, type },
        retroactive  : retroResult,
      };
    });

    res.ok(result, result.retroactive
      ? `Holiday added. ${result.retroactive.affectedCount} attendance record(s) updated retroactively.`
      : 'Holiday added.'
    , 201);
    invalidateCache(req.user.school_id, '/api/sessions*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    invalidateCache(req.user.school_id, '/api/attendance*');
  } catch (err) { 
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    if (err.name === 'SequelizeUniqueConstraintError' || (err.parent && err.parent.code === '23505')) {
      return res.fail('A holiday already exists for this date.');
    }
    next(err); 
  }
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

exports.lock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const result = await sequelize.transaction(async (t) => {
      // First check current status
      const [[current]] = await sequelize.query(`
        SELECT id, status, name FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!current) return res.fail('Session not found.', [], 404);
      if (current.status !== 'active') {
        return res.fail(`Cannot lock a session that is ${current.status}. Only active sessions can be locked.`);
      }

      const [[session]] = await sequelize.query(`
        UPDATE sessions SET is_locked = true, status = 'locked', is_current = false, updated_at = NOW()
        WHERE id = :id AND school_id = :schoolId
        RETURNING id, name, status, is_locked, is_current;
      `, { replacements: { id, schoolId }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'status', 'active', 'locked',
           :userId, :reason, :ip, :device, NOW());
      `, { replacements: {
        id: session.id,
        userId: req.user.id,
        reason: `Session locked by admin`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      return session;
    });

    if (result) {
      res.ok(result, `Session "${result.name}" has been locked and is no longer current.`);
      invalidateCache(schoolId, '/api/sessions*');
      invalidateCache(schoolId, '/api/dashboard*');
    }
  } catch (err) { next(err); }
};

// ── PATCH /api/sessions/:id ─────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date, working_days } = req.body;
    const schoolId = req.user.school_id;

    if (new Date(end_date) <= new Date(start_date)) {
      return res.fail('end_date must be after start_date.');
    }

    await sequelize.transaction(async (t) => {
      // 1. Check if session exists
      const [[session]] = await sequelize.query(`
        SELECT id, status, is_locked, is_current FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!session) return res.fail('Session not found.', [], 404);

      if (session.is_locked || ['closed', 'archived', 'locked'].includes(session.status)) {
        return res.fail(`Cannot update session: it is already ${session.status}.`);
      }

      // 2. Check for overlaps (excluding this session)
      const [[overlap]] = await sequelize.query(`
        SELECT id FROM sessions
        WHERE school_id = :schoolId AND id != :id
          AND (start_date <= :end_date AND end_date >= :start_date)
        LIMIT 1;
      `, { replacements: { schoolId, id, start_date, end_date }, transaction: t });

      if (overlap) {
        return res.fail('Updated dates overlap with another existing session.');
      }

      // 3. Verify existing holidays are still within new range
      const [[holidayCheck]] = await sequelize.query(`
        SELECT COUNT(*) as count FROM session_holidays
        WHERE session_id = :id AND (holiday_date < :start_date OR holiday_date > :end_date);
      `, { replacements: { id, start_date, end_date }, transaction: t });

      if (parseInt(holidayCheck.count) > 0) {
        return res.fail(`Cannot update dates: ${holidayCheck.count} holiday(s) would fall outside the new range.`);
      }

      // 4. Update session
      await sequelize.query(`
        UPDATE sessions
        SET name = :name, start_date = :start_date, end_date = :end_date, updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id, name, start_date, end_date }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'multiple_fields', 'various', 'various',
           :userId, :reason, :ip, :device, NOW());
      `, { replacements: {
        id,
        userId: req.user.id,
        reason: `Session updated by admin`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      // 5. Update working days if provided
      if (working_days) {
        await sequelize.query(`
          UPDATE session_working_days
          SET monday = :mon, tuesday = :tue, wednesday = :wed, thursday = :thu, 
              friday = :fri, saturday = :sat, sunday = :sun
          WHERE session_id = :id;
        `, {
          replacements: {
            id,
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
      }

      // 6. Fetch refreshed session data to return
      const [[updated]] = await sequelize.query(`
        SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
               wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
        FROM sessions s
        LEFT JOIN session_working_days wd ON wd.session_id = s.id
        WHERE s.id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { id, schoolId }, transaction: t });

      res.ok(updated, 'Session updated successfully.');
      invalidateCache(schoolId, '/api/sessions*');
      invalidateCache(schoolId, '/api/dashboard*');
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError' || (err.parent && err.parent.code === '23505')) {
      return res.fail('A session with this name already exists for your school.');
    }
    next(err);
  }
};

// ── PATCH /api/sessions/:id/working-days ────────────────────────────────────
exports.updateWorkingDays = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { working_days } = req.body;
    const schoolId = req.user.school_id;

    if (!working_days) return res.fail('Working days configuration required.');

    await sequelize.transaction(async (t) => {
      // 1. Verify session ownership and status
      const [[session]] = await sequelize.query(`
        SELECT id, status, is_locked FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!session) return res.fail('Session not found.', [], 404);
      if (session.is_locked || ['locked', 'closed', 'archived'].includes(session.status)) {
        return res.fail('Cannot update working days: session is locked or inactive.');
      }

      // 2. Update config
      await sequelize.query(`
        UPDATE session_working_days
        SET monday = :mon, tuesday = :tue, wednesday = :wed, thursday = :thu, 
            friday = :fri, saturday = :sat, sunday = :sun
        WHERE session_id = :id;
      `, {
        replacements: {
          id,
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

      // 3. Audit log
      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, created_at)
        VALUES
          ('sessions', :id, 'working_days', 'previous_config', 'new_config',
           :userId, 'Working days updated mid-session', NOW());
      `, { replacements: { id, userId: req.user.id }, transaction: t });

      // 4. Fetch refreshed session data
      const [[updated]] = await sequelize.query(`
        SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
               wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
        FROM sessions s
        LEFT JOIN session_working_days wd ON wd.session_id = s.id
        WHERE s.id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { id, schoolId }, transaction: t });

      res.ok(updated, 'Working days updated. Note: Historical attendance is not automatically adjusted.');
      invalidateCache(schoolId, '/api/sessions*');
      invalidateCache(schoolId, '/api/attendance*');
    });
  } catch (err) { next(err); }
};

// ── DELETE /api/sessions/:id/holidays/:holidayId ────────────────────────────
exports.removeHoliday = async (req, res, next) => {
  try {
    const { id, holidayId } = req.params;
    const schoolId = req.user.school_id;

    await sequelize.transaction(async (t) => {
      // 1. Verify holiday and session ownership
      const [[holiday]] = await sequelize.query(`
        SELECT h.id, h.holiday_date, s.status, s.is_locked
        FROM session_holidays h
        JOIN sessions s ON s.id = h.session_id
        WHERE h.id = :holidayId AND h.session_id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { holidayId, id, schoolId }, transaction: t });

      if (!holiday) return res.fail('Holiday not found.', [], 404);
      if (holiday.is_locked || ['locked', 'closed', 'archived'].includes(holiday.status)) {
        return res.fail('Cannot modify holidays on a closed, archived or locked session.');
      }

      // 2. Delete holiday
      await sequelize.query(`DELETE FROM session_holidays WHERE id = :holidayId;`, {
        replacements: { holidayId },
        transaction: t
      });

      // 3. Reverse retroactive attendance (Delete 'holiday' records for this date)
      // This forces re-marking for converted records and cleans up auto-inserted ones.
      const [deletedAttendance] = await sequelize.query(`
        DELETE FROM attendance
        WHERE date = :date
          AND status = 'holiday'
          AND enrollment_id IN (SELECT id FROM enrollments WHERE session_id = :id);
      `, { replacements: { date: holiday.holiday_date, id }, transaction: t });

      // 4. Audit log
      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, created_at)
        VALUES
          ('sessions', :id, 'holiday_removed', :date, 'removed',
           :userId, 'Holiday deleted. Associated "holiday" attendance records removed.', NOW());
      `, { replacements: { id, date: holiday.holiday_date, userId: req.user.id }, transaction: t });

      res.ok({
        removed_holiday_date: holiday.holiday_date,
        attendance_records_cleared: deletedAttendance.rowCount || 0
      }, 'Holiday removed. Associated attendance records cleared.');

      invalidateCache(schoolId, '/api/sessions*');
      invalidateCache(schoolId, '/api/dashboard*');
      invalidateCache(schoolId, '/api/attendance*');
    });
  } catch (err) { next(err); }
};

// ── DELETE /api/sessions/:id ────────────────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    await sequelize.transaction(async (t) => {
      const [[session]] = await sequelize.query(`
        SELECT id, is_current FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!session) return res.fail('Session not found.', [], 404);
      if (session.is_current) return res.fail('Cannot delete the current active session.');

      // Safety Guard: Check for any dependent data (Enrollments, Attendance, Exams)
      // This prevents deleting sessions that contain historical student records.
      const [[usage]] = await sequelize.query(`
        SELECT 
          (SELECT COUNT(*) FROM enrollments WHERE session_id = :id) AS enrollment_count,
          (SELECT COUNT(*) FROM attendance WHERE enrollment_id IN (SELECT id FROM enrollments WHERE session_id = :id)) AS attendance_count,
          (SELECT COUNT(*) FROM exams WHERE session_id = :id) AS exam_count
      `, { replacements: { id }, transaction: t });

      if (parseInt(usage.enrollment_count) > 0 || parseInt(usage.attendance_count) > 0 || parseInt(usage.exam_count) > 0) {
        return res.fail(
          `Cannot delete session: it contains ${usage.enrollment_count} enrollment(s), ` +
          `${usage.attendance_count} attendance record(s), and ${usage.exam_count} exam(s). ` +
          `Try archiving it instead to preserve historical data.`
        );
      }

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'deleted', 'exists', 'none',
           :userId, :reason, :ip, :device, NOW());
      `, { replacements: {
        id,
        userId: req.user.id,
        reason: `Session deleted by admin`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      await sequelize.query(`DELETE FROM sessions WHERE id = :id;`, { replacements: { id }, transaction: t });

      res.ok(null, 'Session deleted successfully.');
      invalidateCache(schoolId, '/api/sessions*');
      invalidateCache(schoolId, '/api/dashboard*');
    });
  } catch (err) { next(err); }
};

// ── PATCH /api/sessions/:id/archive ─────────────────────────────────────────
exports.archive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    await sequelize.transaction(async (t) => {
      const [[session]] = await sequelize.query(`
        SELECT id, status, is_current FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!session) return res.fail('Session not found.', [], 404);
      if (session.is_current) return res.fail('Cannot archive the current active session.');
      if (session.status !== 'closed') {
        return res.fail('Only closed sessions can be archived.');
      }

      await sequelize.query(`
        UPDATE sessions SET status = 'archived', updated_at = NOW() WHERE id = :id;
      `, { replacements: { id }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, created_at)
        VALUES
          ('sessions', :id, 'status', 'closed', 'archived',
           :userId, 'Session archived by admin', NOW());
      `, { replacements: { id, userId: req.user.id }, transaction: t });

      // 4. Fetch refreshed session data
      const [[updated]] = await sequelize.query(`
        SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
               wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
        FROM sessions s
        LEFT JOIN session_working_days wd ON wd.session_id = s.id
        WHERE s.id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { id, schoolId }, transaction: t });

      res.ok(updated, 'Session archived successfully.');
      invalidateCache(schoolId, '/api/sessions*');
    });
  } catch (err) { next(err); }
};

// ── GET /api/sessions/:id/stats ─────────────────────────────────────────────
exports.getStats = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    // 0. Ownership Guard: Verify session belongs to this school
    const [[session]] = await sequelize.query(`
      SELECT id FROM sessions WHERE id = :id AND school_id = :schoolId LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!session) return res.fail('Session not found or unauthorized access.', [], 404);

    // 1. Basic counts
    const [[counts]] = await sequelize.query(`
      SELECT 
        (SELECT COUNT(*) FROM enrollments WHERE session_id = :id) as total_students,
        (SELECT COUNT(*) FROM session_holidays WHERE session_id = :id) as holiday_count,
        (SELECT COUNT(*) FROM exams WHERE session_id = :id) as exam_count
    `, { replacements: { id } });

    // 2. Attendance stats (overall % for session)
    // We calculate the total effective presence and divide by the total expected working days for all active students.
    const [[sessionInfo]] = await sequelize.query(`
      SELECT start_date, end_date FROM sessions WHERE id = :id LIMIT 1;
    `, { replacements: { id } });

    const [[wdRow]] = await sequelize.query(`
      SELECT monday, tuesday, wednesday, thursday, friday, saturday, sunday
      FROM session_working_days WHERE session_id = :id LIMIT 1;
    `, { replacements: { id } });

    const [holidayRows] = await sequelize.query(`
      SELECT holiday_date FROM session_holidays WHERE session_id = :id AND holiday_date <= :today;
    `, { replacements: { id, today: new Date().toISOString().split('T')[0] } });

    const [enrollmentRows] = await sequelize.query(`
      SELECT joined_date FROM enrollments WHERE session_id = :id AND status = 'active';
    `, { replacements: { id } });

    const { _internal } = require('../utils/attendanceCalculator');
    const today = new Date().toISOString().split('T')[0];
    const calcUpTo = today < sessionInfo.end_date ? today : sessionInfo.end_date;
    const allDates = _internal.getDateRange(sessionInfo.start_date, calcUpTo);
    
    const holidaySet = new Set(holidayRows.map(h => h.holiday_date));
    const workingDates = allDates.filter(date => {
      const dayOfWeek = _internal.getDayOfWeek(date);
      const colName = _internal.DAY_COLUMN_MAP[dayOfWeek];
      return wdRow[colName] && !holidaySet.has(date);
    });

    let totalExpectedRecords = 0;
    enrollmentRows.forEach(e => {
      // Binary search or simple find index for first date >= joined_date
      // For simplicity and safety, we'll use a simple loop or filter here as the numbers are manageable
      const studentWorkingDays = workingDates.filter(d => d >= e.joined_date).length;
      totalExpectedRecords += studentWorkingDays;
    });

    const [[presence]] = await sequelize.query(`
      SELECT 
        SUM(CASE WHEN status IN ('present', 'late') THEN 1.0 WHEN status = 'half_day' THEN 0.5 ELSE 0 END) as effective_present
      FROM attendance
      WHERE enrollment_id IN (SELECT id FROM enrollments WHERE session_id = :id)
        AND status != 'holiday'
        AND date <= :calcUpTo
    `, { replacements: { id, calcUpTo } });

    const avgRate = totalExpectedRecords > 0 
      ? parseFloat(((parseFloat(presence.effective_present || 0) / totalExpectedRecords) * 100).toFixed(2))
      : 0;

    // 3. Fee stats (total collected vs total target)
    const [[fees]] = await sequelize.query(`
      SELECT 
        SUM(amount_due + late_fee_amount - concession_amount) as target,
        SUM(amount_paid) as collected,
        ROUND((SUM(amount_paid) / NULLIF(SUM(amount_due + late_fee_amount - concession_amount), 0) * 100), 2) as collection_pct
      FROM fee_invoices
      WHERE enrollment_id IN (SELECT id FROM enrollments WHERE session_id = :id)
    `, { replacements: { id } });

    res.ok({
      students: parseInt(counts.total_students || 0),
      holidays: parseInt(counts.holiday_count || 0),
      exams: parseInt(counts.exam_count || 0),
      attendance_rate: avgRate,
      fee_stats: {
        target: parseFloat(fees.target || 0),
        collected: parseFloat(fees.collected || 0),
        percentage: parseFloat(fees.collection_pct || 0)
      }
    });
  } catch (err) { next(err); }
};
