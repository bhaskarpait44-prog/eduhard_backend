'use strict';

const sequelize = require('../config/database');
const { retroactiveHoliday, _internal } = require('../utils/attendanceCalculator');
const { invalidateCache } = require('../middlewares/cache');

// ── POST /api/sessions ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { name, start_date, end_date, working_days } = req.body;
    const schoolId = req.user.school_id;

    if (new Date(end_date) <= new Date(start_date)) {
      return res.fail('end_date must be after start_date.');
    }

    const session = await sequelize.transaction(async (t) => {
      // Check for overlapping sessions
      const [[overlap]] = await sequelize.query(`
        SELECT id FROM sessions
        WHERE school_id = :schoolId
          AND (start_date <= :end_date AND end_date >= :start_date)
        LIMIT 1;
      `, { replacements: { schoolId, start_date, end_date }, transaction: t });

      if (overlap) {
        throw { name: 'CustomError', message: 'This session dates overlap with an existing session.', status: 400 };
      }

      const [[newSession]] = await sequelize.query(`
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
          sid : newSession.id,
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
        id: newSession.id,
        userId: req.user.id,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      // Fetch full refreshed session data to return (matching list format)
      const [[session]] = await sequelize.query(`
        SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
               wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
        FROM sessions s
        LEFT JOIN session_working_days wd ON wd.session_id = s.id
        WHERE s.id = :id
        LIMIT 1;
      `, { replacements: { id: newSession.id }, transaction: t });

      return session;
    });

    res.ok(session, 'Session created.', 201);
    invalidateCache(schoolId, '/api/sessions*');
    invalidateCache(schoolId, '/api/dashboard*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    if (err.name === 'SequelizeUniqueConstraintError' || (err.parent && err.parent.code === '23505')) {
      return res.fail('A session with this name already exists for your school.');
    }
    next(err);
  }
};

// ── GET /api/sessions ────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page,  10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100); // FIX: cap at 100 to prevent resource exhaustion
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

    const sessionData = await sequelize.transaction(async (t) => {
      // 1. Verify target session exists and belongs to this school
      const [[target]] = await sequelize.query(`
        SELECT id, name, status FROM sessions WHERE id = :id AND school_id = :schoolId LIMIT 1;
      `, { replacements: { id, schoolId: req.user.school_id }, transaction: t });

      if (!target) throw { name: 'CustomError', message: 'Session not found.', status: 404 };
      const validStatuses = ['upcoming', 'locked'];
      if (!validStatuses.includes(target.status)) {
        throw { name: 'CustomError', message: `Cannot activate a session that is ${target.status}. Only ${validStatuses.join(' or ')} sessions can be activated.`, status: 400 };
      }

      // 2. Only one session can be current per school
      const [[current]] = await sequelize.query(`
        SELECT id, name FROM sessions WHERE school_id = :schoolId AND is_current = true;
      `, { replacements: { schoolId: req.user.school_id }, transaction: t });

      if (current) {
        await sequelize.query(`
          UPDATE sessions SET is_current = false, status = 'closed', is_locked = false, updated_at = NOW()
          WHERE id = :id;
        `, { replacements: { id: current.id }, transaction: t }); // FIX: also clear is_locked to prevent stuck closed+locked state

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
          reason: `Session "${current.name}" automatically closed upon activation of "${target.name}"`,
          ip: req.ip || null,
          device: (req.headers['user-agent'] || '').slice(0, 299)
        }, transaction: t });
      }

      await sequelize.query(`
        UPDATE sessions SET is_current = true, status = 'active', is_locked = false, updated_at = NOW()
        WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId: req.user.school_id }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'status', :oldStatus, 'active',
           :userId, :reason, :ip, :device, NOW());
      `, { replacements: {
        id,
        oldStatus: target.status,
        userId: req.user.id,
        reason: `Session "${target.name}" activated by admin`,
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

      return session;
    });

    res.ok(sessionData, `Session "${sessionData.name}" activated.`);
    invalidateCache(req.user.school_id, '/api/sessions*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    next(err);
  }
};

// ── POST /api/sessions/:id/holidays ─────────────────────────────────────────
exports.addHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { holiday_date, end_date, name, type } = req.body;

    const startDateStr = holiday_date;
    const endDateStr = end_date || holiday_date;

    if (new Date(endDateStr) < new Date(startDateStr)) {
      return res.fail('End date must be on or after start date.', [], 400);
    }

    const result = await sequelize.transaction(async (t) => {
      // 1. Fetch session metadata for validation (Inside transaction)
      const [[session]] = await sequelize.query(`
        SELECT start_date, end_date, status, is_locked 
        FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId: req.user.school_id }, transaction: t });

      if (!session) {
        throw { name: 'CustomError', message: 'Session not found.', status: 404 };
      }

      // FIX: use a whitelist instead of an exclusion list — only active sessions allow holiday changes
      if (session.status !== 'active' || session.is_locked) {
        throw { name: 'CustomError', message: `Cannot add holiday: session must be active and unlocked (current status: ${session.status}).`, status: 400 };
      }

      // Generate date range
      const dates = [];
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(0, 0, 0, 0);
      
      let curr = new Date(start);
      while (curr <= end) {
        dates.push(curr.toISOString().slice(0, 10));
        curr.setUTCDate(curr.getUTCDate() + 1);
      }

      // Validate all dates in the range
      const sessionStart = new Date(session.start_date);
      const sessionEnd = new Date(session.end_date);
      for (const d of dates) {
        const dObj = new Date(d);
        if (dObj < sessionStart || dObj > sessionEnd) {
          throw { name: 'CustomError', message: `Holiday date (${d}) must be between session start (${session.start_date}) and end (${session.end_date}).`, status: 400 };
        }
      }

      // Check for duplicate holidays in the range
      const [existingHolidays] = await sequelize.query(`
        SELECT holiday_date FROM session_holidays WHERE session_id = :sessionId AND holiday_date IN (:dates);
      `, { replacements: { sessionId: id, dates }, transaction: t });

      if (existingHolidays.length > 0) {
        const dupStr = existingHolidays.map(h => h.holiday_date).join(', ');
        throw { name: 'CustomError', message: `Holiday already exists for these dates: ${dupStr}`, status: 400 };
      }

      const createdHolidays = [];
      let totalAffectedRecords = 0;

      for (const d of dates) {
        // Check if attendance already marked
        const [[existingAttendance]] = await sequelize.query(`
          SELECT COUNT(*) AS cnt FROM attendance a
          JOIN enrollments e ON e.id = a.enrollment_id
          WHERE e.session_id = :sessionId AND a.date = :date;
        `, { replacements: { sessionId: id, date: d }, transaction: t });

        // Insert holiday record
        const [[newHoliday]] = await sequelize.query(`
          INSERT INTO session_holidays (session_id, holiday_date, name, type, added_by, created_at)
          VALUES (:sessionId, :date, :name, :type, :addedBy, NOW())
          RETURNING id;
        `, { replacements: { sessionId: id, date: d, name, type, addedBy: req.user.id }, transaction: t });

        let retroResult = null;
        if (parseInt(existingAttendance.cnt, 10) > 0) {
          retroResult = await retroactiveHoliday(parseInt(id), d, name, req.user.id, t);
          if (retroResult) {
            totalAffectedRecords += retroResult.affectedCount;
          }
        }

        // Audit log
        await sequelize.query(`
          INSERT INTO audit_logs
            (table_name, record_id, field_name, old_value, new_value,
             changed_by, reason, ip_address, device_info, created_at)
          VALUES
            ('session_holidays', :recId, 'holiday_added', 'none', :date,
             :userId, :reason, :ip, :device, NOW());
        `, { replacements: {
          recId: newHoliday.id,
          date: d,
          userId: req.user.id,
          reason: `Holiday "${name}" added to session`,
          ip: req.ip || null,
          device: (req.headers['user-agent'] || '').slice(0, 299)
        }, transaction: t });

        createdHolidays.push({ id: newHoliday.id, session_id: id, holiday_date: d, name, type });
      }

      return {
        holiday      : createdHolidays[0], // backward compatibility
        holidays     : createdHolidays,
        retroactive  : totalAffectedRecords > 0 ? { affectedCount: totalAffectedRecords } : null
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

    const session = await sequelize.transaction(async (t) => {
      // First check current status
      const [[current]] = await sequelize.query(`
        SELECT id, status, name FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!current) throw { name: 'CustomError', message: 'Session not found.', status: 404 };
      if (current.status !== 'active') {
        throw { name: 'CustomError', message: `Cannot lock a session that is ${current.status}. Only active sessions can be locked.`, status: 400 };
      }

      const [[updatedSession]] = await sequelize.query(`
        UPDATE sessions SET is_locked = true, status = 'locked', updated_at = NOW()
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
        id: updatedSession.id,
        userId: req.user.id,
        reason: `Session locked by admin`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      return updatedSession;
    });

    res.ok(session, `Session "${session.name}" has been locked.`);
    invalidateCache(schoolId, '/api/sessions*');
    invalidateCache(schoolId, '/api/dashboard*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    next(err);
  }
};

exports.unlock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const session = await sequelize.transaction(async (t) => {
      const [[current]] = await sequelize.query(`
        SELECT id, status, name FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!current) throw { name: 'CustomError', message: 'Session not found.', status: 404 };
      if (current.status !== 'locked') {
        throw { name: 'CustomError', message: `Cannot unlock a session that is ${current.status}. Only locked sessions can be unlocked.`, status: 400 };
      }

      const [[updatedSession]] = await sequelize.query(`
        UPDATE sessions SET is_locked = false, status = 'active', updated_at = NOW()
        WHERE id = :id AND school_id = :schoolId
        RETURNING id, name, status, is_locked, is_current;
      `, { replacements: { id, schoolId }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'status', 'locked', 'active',
           :userId, :reason, :ip, :device, NOW());
      `, { replacements: {
        id: updatedSession.id,
        userId: req.user.id,
        reason: `Session unlocked by admin`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      return updatedSession;
    });

    res.ok(session, `Session "${session.name}" has been unlocked and restored to active status.`);
    invalidateCache(schoolId, '/api/sessions*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    next(err);
  }
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

    const updated = await sequelize.transaction(async (t) => {
      // 1. Check if session exists
      const [[session]] = await sequelize.query(`
        SELECT id, status, is_locked, is_current FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!session) throw { name: 'CustomError', message: 'Session not found.', status: 404 };

      // FIX: use a whitelist — only upcoming or active sessions can be updated
      if (session.is_locked || !['upcoming', 'active'].includes(session.status)) {
        throw { name: 'CustomError', message: `Cannot update session: it is already ${session.status}.`, status: 400 };
      }

      // 2. Check for overlaps (excluding this session)
      const [[overlap]] = await sequelize.query(`
        SELECT id FROM sessions
        WHERE school_id = :schoolId AND id != :id
          AND (start_date <= :end_date AND end_date >= :start_date)
        LIMIT 1;
      `, { replacements: { schoolId, id, start_date, end_date }, transaction: t });

      if (overlap) {
        throw { name: 'CustomError', message: 'Updated dates overlap with another existing session.', status: 400 };
      }

      // 3. Verify existing holidays are still within new range
      const [[holidayCheck]] = await sequelize.query(`
        SELECT COUNT(*) as count FROM session_holidays
        WHERE session_id = :id AND (holiday_date < :start_date OR holiday_date > :end_date);
      `, { replacements: { id, start_date, end_date }, transaction: t });

      if (parseInt(holidayCheck.count) > 0) {
        throw { name: 'CustomError', message: `Cannot update dates: ${holidayCheck.count} holiday(s) would fall outside the new range.`, status: 400 };
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
      // FIX: guard against empty object {} which would silently reset schedule to defaults
      if (working_days && typeof working_days === 'object' && Object.keys(working_days).length > 0) {
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
      const [[updatedSession]] = await sequelize.query(`
        SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
               wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
        FROM sessions s
        LEFT JOIN session_working_days wd ON wd.session_id = s.id
        WHERE s.id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { id, schoolId }, transaction: t });

      return updatedSession;
    });

    res.ok(updated, 'Session updated successfully.');
    invalidateCache(schoolId, '/api/sessions*');
    invalidateCache(schoolId, '/api/dashboard*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
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

    const updated = await sequelize.transaction(async (t) => {
      // 1. Verify session ownership and status
      const [[session]] = await sequelize.query(`
        SELECT id, status, is_locked FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!session) throw { name: 'CustomError', message: 'Session not found.', status: 404 };
      // FIX: use a whitelist — only upcoming or active sessions allow working-day changes
      if (session.is_locked || !['upcoming', 'active'].includes(session.status)) {
        throw { name: 'CustomError', message: 'Cannot update working days: session is locked or inactive.', status: 400 };
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
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'working_days', 'previous_config', 'new_config',
           :userId, 'Working days updated mid-session', :ip, :device, NOW());
      `, { replacements: { 
        id, 
        userId: req.user.id,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      // 4. Fetch refreshed session data
      const [[updatedSession]] = await sequelize.query(`
        SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
               wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
        FROM sessions s
        LEFT JOIN session_working_days wd ON wd.session_id = s.id
        WHERE s.id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { id, schoolId }, transaction: t });

      return updatedSession;
    });

    res.ok(updated, 'Working days updated. Note: Historical attendance is not automatically adjusted.');
    invalidateCache(schoolId, '/api/sessions*');
    invalidateCache(schoolId, '/api/attendance*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    next(err);
  }
};

// ── DELETE /api/sessions/:id/holidays/:holidayId ────────────────────────────
exports.removeHoliday = async (req, res, next) => {
  try {
    const { id, holidayId } = req.params;
    const schoolId = req.user.school_id;

    const removedDate = await sequelize.transaction(async (t) => {
      // 1. Verify holiday and session ownership
      const [[holiday]] = await sequelize.query(`
        SELECT h.id, h.holiday_date, s.status, s.is_locked
        FROM session_holidays h
        JOIN sessions s ON s.id = h.session_id
        WHERE h.id = :holidayId AND h.session_id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { holidayId, id, schoolId }, transaction: t });

      if (!holiday) throw { name: 'CustomError', message: 'Holiday not found.', status: 404 };
      // FIX: use whitelist — only active sessions allow holiday changes
      if (holiday.status !== 'active' || holiday.is_locked) {
        throw { name: 'CustomError', message: 'Cannot modify holidays on a session that is not active and unlocked.', status: 400 };
      }

      // 2. Delete holiday
      await sequelize.query(`DELETE FROM session_holidays WHERE id = :holidayId;`, {
        replacements: { holidayId },
        transaction: t
      });

      // 3. Reverse retroactive attendance
      // Restore from previous_status if it exists, otherwise delete the 'holiday' record
      await sequelize.query(`
        UPDATE attendance
        SET 
          status = previous_status::enum_attendance_status,
          previous_status = NULL,
          override_reason = 'Holiday removed; original status restored.',
          updated_at = NOW()
        WHERE date = :date
          AND status = 'holiday'
          AND previous_status IS NOT NULL
          AND enrollment_id IN (SELECT id FROM enrollments WHERE session_id = :id);
      `, { replacements: { date: holiday.holiday_date, id }, transaction: t });

      await sequelize.query(`
        DELETE FROM attendance
        WHERE date = :date
          AND status = 'holiday'
          AND previous_status IS NULL
          AND enrollment_id IN (SELECT id FROM enrollments WHERE session_id = :id);
      `, { replacements: { date: holiday.holiday_date, id }, transaction: t });

      // 4. Audit log
      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('session_holidays', :holidayId, 'holiday_removed', :date, 'removed',
           :userId, :reason, :ip, :device, NOW());
      `, { replacements: { 
        holidayId, 
        date: holiday.holiday_date, 
        userId: req.user.id,
        reason: `Holiday removed by admin`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      return holiday.holiday_date;
    });

    res.ok({ removed_holiday_date: removedDate }, 'Holiday removed. Associated attendance records cleared.');

    invalidateCache(schoolId, '/api/sessions*');
    invalidateCache(schoolId, '/api/dashboard*');
    invalidateCache(schoolId, '/api/attendance*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    next(err);
  }
};

// ── DELETE /api/sessions/:id ────────────────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    await sequelize.transaction(async (t) => {
      const [[session]] = await sequelize.query(`
        SELECT id, name, is_current FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!session) throw { name: 'CustomError', message: 'Session not found.', status: 404 };
      if (session.is_current) throw { name: 'CustomError', message: 'Cannot delete the current active session.', status: 400 };

      // Safety Guard: Check for any dependent data (Enrollments, Attendance, Exams)
      const [[usage]] = await sequelize.query(`
        SELECT 
          (SELECT COUNT(*) FROM enrollments WHERE session_id = :id) AS enrollment_count,
          (SELECT COUNT(*) FROM attendance WHERE enrollment_id IN (SELECT id FROM enrollments WHERE session_id = :id)) AS attendance_count,
          (SELECT COUNT(*) FROM exams WHERE session_id = :id) AS exam_count
      `, { replacements: { id }, transaction: t });

      if (parseInt(usage.enrollment_count) > 0 || parseInt(usage.attendance_count) > 0 || parseInt(usage.exam_count) > 0) {
        throw { 
          name: 'CustomError', 
          message: `Cannot delete session: it contains ${usage.enrollment_count} enrollment(s), ` +
                   `${usage.attendance_count} attendance record(s), and ${usage.exam_count} exam(s). ` +
                   `Try archiving it instead to preserve historical data.`,
          status: 400 
        };
      }

      // FIX: DELETE first, then audit log — avoids FK violation if audit_logs references sessions.id
      await sequelize.query(`DELETE FROM sessions WHERE id = :id;`, { replacements: { id }, transaction: t });

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
        reason: `Session "${session.name}" deleted by admin`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });
    });

    res.ok(null, 'Session deleted successfully.');
    invalidateCache(schoolId, '/api/sessions*');
    invalidateCache(schoolId, '/api/dashboard*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    next(err);
  }
};

// ── PATCH /api/sessions/:id/archive ─────────────────────────────────────────
exports.archive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const updated = await sequelize.transaction(async (t) => {
      const [[session]] = await sequelize.query(`
        SELECT id, status, is_current FROM sessions WHERE id = :id AND school_id = :schoolId;
      `, { replacements: { id, schoolId }, transaction: t });

      if (!session) throw { name: 'CustomError', message: 'Session not found.', status: 404 };
      if (session.is_current) throw { name: 'CustomError', message: 'Cannot archive the current active session.', status: 400 };
      if (session.status !== 'closed') {
        throw { name: 'CustomError', message: 'Only closed sessions can be archived.', status: 400 };
      }

      await sequelize.query(`
        UPDATE sessions SET status = 'archived', is_locked = false, updated_at = NOW() WHERE id = :id;
      `, { replacements: { id }, transaction: t }); // FIX: ensure is_locked is cleared on archive

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('sessions', :id, 'status', 'closed', 'archived',
           :userId, 'Session archived by admin', :ip, :device, NOW());
      `, { replacements: { 
        id, 
        userId: req.user.id,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });

      // 4. Fetch refreshed session data
      const [[updatedSession]] = await sequelize.query(`
        SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.is_current, s.is_locked,
               wd.monday, wd.tuesday, wd.wednesday, wd.thursday, wd.friday, wd.saturday, wd.sunday
        FROM sessions s
        LEFT JOIN session_working_days wd ON wd.session_id = s.id
        WHERE s.id = :id AND s.school_id = :schoolId
        LIMIT 1;
      `, { replacements: { id, schoolId }, transaction: t });

      return updatedSession;
    });

    res.ok(updated, 'Session archived successfully.');
    invalidateCache(schoolId, '/api/sessions*');
  } catch (err) {
    if (err.name === 'CustomError') {
      return res.fail(err.message, [], err.status || 400);
    }
    next(err);
  }
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
      SELECT joined_date, left_date FROM enrollments WHERE session_id = :id;
    `, { replacements: { id } });

    const today = new Date().toISOString().split('T')[0];
    // FIX: normalize dates to plain YYYY-MM-DD strings to avoid Date-vs-string comparison bugs
    const sessionStart = String(sessionInfo.start_date).slice(0, 10);
    const sessionEnd   = String(sessionInfo.end_date).slice(0, 10);
    const calcUpTo = today < sessionEnd ? today : sessionEnd;
    const allDates = _internal.getDateRange(sessionStart, calcUpTo);
    
    const holidaySet = new Set(holidayRows.map(h => {
      const d = h.holiday_date;
      return d instanceof Date ? d.toISOString().split('T')[0] : String(d).slice(0, 10);
    }));
    // FIX: guard against missing working-days row to prevent crash
    const workingDates = allDates.filter(date => {
      if (!wdRow) return false;
      const dayOfWeek = _internal.getDayOfWeek(date);
      const colName = _internal.DAY_COLUMN_MAP[dayOfWeek];
      return wdRow[colName] && !holidaySet.has(date);
    });

    let totalExpectedRecords = 0;
    enrollmentRows.forEach(e => {
      const joinedDateOnly = (e.joined_date || '').slice(0, 10);
      const leftDateOnly = e.left_date ? (e.left_date || '').slice(0, 10) : null;
      
      const studentWorkingDays = workingDates.filter(d => 
        d >= joinedDateOnly && (!leftDateOnly || d <= leftDateOnly)
      ).length;
      
      totalExpectedRecords += studentWorkingDays;
    });

    const [[presence]] = await sequelize.query(`
      SELECT 
        SUM(CASE WHEN a.status IN ('present', 'late') THEN 1.0 WHEN a.status = 'half_day' THEN 0.5 ELSE 0 END) as effective_present
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      WHERE e.session_id = :id
        AND a.status != 'holiday'
        AND a.date >= e.joined_date
        AND a.date <= :calcUpTo
        AND (e.left_date IS NULL OR a.date <= e.left_date)
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
