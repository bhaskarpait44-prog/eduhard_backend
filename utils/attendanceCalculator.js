'use strict';

/**
 * utils/attendanceCalculator.js
 *
 * Three pure calculation functions + one retroactive holiday handler.
 * No Express, no routes — these are called by controllers in Step 8.
 *
 * All date parameters are strings: 'YYYY-MM-DD'
 */

const { Op }       = require('sequelize');
const sequelize    = require('../config/database');
const Attendance   = require('../models/Attendance');
const Enrollment   = require('../models/Enrollment');

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all dates between start and end (inclusive) as 'YYYY-MM-DD' strings.
 */
function getDateRange(startDate, endDate) {
  const dates = [];
  let current = new Date(startDate);
  const end     = new Date(endDate);

  // Normalize to midnight UTC to prevent DST shifts
  current.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current = new Date(current.setUTCDate(current.getUTCDate() + 1));
  }
  return dates;
}

/**
 * Returns the JS day-of-week (0=Sun, 1=Mon ... 6=Sat) for a 'YYYY-MM-DD' string.
 */
function getDayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

/**
 * Maps session_working_days DB columns to JS getUTCDay() values.
 */
const DAY_COLUMN_MAP = {
  0 : 'sunday',
  1 : 'monday',
  2 : 'tuesday',
  3 : 'wednesday',
  4 : 'thursday',
  5 : 'friday',
  6 : 'saturday',
};


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 1: getWorkingDays
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Counts school working days between two dates for a given session.
 *
 * Algorithm:
 *   1. Generate all calendar dates in the range
 *   2. Remove weekend days (using session_working_days config)
 *   3. Remove declared holidays (using session_holidays)
 *   4. Return the count + the list of actual working dates
 *
 * @param {number} sessionId
 * @param {string} fromDate   'YYYY-MM-DD'
 * @param {string} toDate     'YYYY-MM-DD'
 * @param {object} t          Optional sequelize transaction
 *
 * @returns {{
 *   workingDays   : number,
 *   workingDates  : string[],
 *   removedWeekends  : number,
 *   removedHolidays  : number,
 *   holidays      : Array<{ date: string, name: string }>
 * }}
 */
async function getWorkingDays(sessionId, fromDate, toDate, t = null) {
  // ── Fetch working day config for this session ────────────────────────────
  const [[workingDaysRow]] = await sequelize.query(`
    SELECT monday, tuesday, wednesday, thursday, friday, saturday, sunday
    FROM session_working_days
    WHERE session_id = :sessionId
    LIMIT 1;
  `, { replacements: { sessionId }, transaction: t });

  if (!workingDaysRow) {
    throw { name: 'AttendanceConfigError', message: `No working_days config found for session_id=${sessionId}.`, status: 422 };
  }

  // ── Fetch all holidays in this session within the date range ─────────────
  const [holidayRows] = await sequelize.query(`
    SELECT holiday_date, name
    FROM session_holidays
    WHERE session_id  = :sessionId
      AND holiday_date >= :fromDate
      AND holiday_date <= :toDate
    ORDER BY holiday_date ASC;
  `, { replacements: { sessionId, fromDate, toDate }, transaction: t });

  const holidaySet = new Set(holidayRows.map(h => h.holiday_date));

  // ── Walk the date range ──────────────────────────────────────────────────
  const allDates      = getDateRange(fromDate, toDate);
  const workingDates  = [];
  let removedWeekends = 0;
  let removedHolidays = 0;

  for (const date of allDates) {
    const dayOfWeek = getDayOfWeek(date);
    const colName   = DAY_COLUMN_MAP[dayOfWeek];

    // Skip if this weekday is not a working day for this session
    if (!workingDaysRow[colName]) {
      removedWeekends++;
      continue;
    }

    // Skip declared holidays
    if (holidaySet.has(date)) {
      removedHolidays++;
      continue;
    }

    workingDates.push(date);
  }

  return {
    workingDays     : workingDates.length,
    workingDates,
    removedWeekends,
    removedHolidays,
    holidays        : holidayRows.map(h => ({ date: h.holiday_date, name: h.name })),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 2: getAttendancePercent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates attendance percentage for a single enrollment.
 *
 * Key rules:
 *   - Working days counted from joined_date (not session start)
 *     Because: a transfer student who joined 2 months in shouldn't
 *     be penalised for days before they arrived.
 *   - present  → counts as 1.0
 *   - late     → counts as 1.0 (present but late)
 *   - half_day → counts as 0.5
 *   - absent   → counts as 0.0
 *   - holiday  → excluded from both numerator AND denominator
 *
 * Formula:
 *   percentage = (present + late + half_day×0.5) / workingDays × 100
 *
 * @param {number} enrollmentId
 * @param {object} t            Optional sequelize transaction
 * @returns {{
 *   enrollmentId    : number,
 *   studentId       : number,
 *   sessionId       : number,
 *   joinedDate      : string,
 *   calculatedUpTo  : string,
 *   workingDays     : number,
 *   presentCount    : number,
 *   lateCount       : number,
 *   halfDayCount    : number,
 *   absentCount     : number,
 *   effectivePresent: number,
 *   percentage      : number,
 *   grade           : string,
 * }}
 */
async function getAttendancePercent(enrollmentId, t = null) {
  const results = await getAttendanceStatsForEnrollments([enrollmentId], {}, t);
  if (results.length === 0) {
    throw new Error(`Enrollment id=${enrollmentId} not found.`);
  }
  const stats = results[0];
  const effectivePresent =
    stats.presentCount  * 1.0 +
    stats.lateCount     * 1.0 +
    stats.halfDayCount * 0.5;
  return {
    ...stats,
    effectivePresent
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 3: retroactiveHoliday
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles retroactive holiday declaration for a session date.
 *
 * When a new holiday is added AFTER attendance has already been marked,
 * this function:
 *   1. Finds all attendance records for that date in this session
 *   2. Updates their status to 'holiday' + records override_reason
 *   3. Returns affected students with their recalculated percentages
 *
 * The holiday row in session_holidays must already be inserted BEFORE
 * calling this function (so getWorkingDays excludes it in recalculation).
 *
 * @param {number} sessionId
 * @param {string} holidayDate  'YYYY-MM-DD'
 * @param {string} holidayName  for the override_reason message
 * @param {number} declaredBy   user id who declared the holiday
 * @param {object} t            Optional sequelize transaction
 *
 * @returns {{
 *   date             : string,
 *   affectedCount    : number,
 *   affectedStudents : Array<{ enrollmentId, studentId, oldStatus, newPercentage }>
 * }}
 */
async function retroactiveHoliday(sessionId, holidayDate, holidayName, declaredBy, t = null) {
  const execute = async (transaction) => {
    // ── Step 1: Find all enrollment ids active in this session ───────────
    const [enrollmentRows] = await sequelize.query(`
      SELECT e.id AS enrollment_id, e.student_id, e.joined_date
      FROM enrollments e
      WHERE e.session_id = :sessionId
        AND e.status     = 'active'
        AND e.joined_date <= :holidayDate;
    `, { replacements: { sessionId, holidayDate }, transaction });

    if (enrollmentRows.length === 0) {
      return { date: holidayDate, affectedCount: 0, affectedStudents: [] };
    }

    const enrollmentIds = enrollmentRows.map(e => e.enrollment_id);

    // ── Step 2: Find existing attendance records for that date ────────────
    const [existingRecords] = await sequelize.query(`
      SELECT id, enrollment_id, status
      FROM attendance
      WHERE date          = :holidayDate
        AND enrollment_id IN (:enrollmentIds)
        AND status        != 'holiday';
    `, { replacements: { holidayDate, enrollmentIds }, transaction });

    const overrideReason =
      `Retroactive holiday declared: "${holidayName}" on ${holidayDate}. ` +
      `Original attendance overridden by system.`;

    // ── Step 3: Update existing records to holiday ────────────────────────
    if (existingRecords.length > 0) {
      const affectedIds = existingRecords.map(r => r.id);
      await sequelize.query(`
        UPDATE attendance
        SET
          previous_status = status,
          status          = 'holiday',
          override_reason = :overrideReason,
          marked_by       = :declaredBy,
          marked_at       = NOW(),
          updated_at      = NOW()
        WHERE id IN (:affectedIds);
      `, { replacements: { overrideReason, declaredBy, affectedIds }, transaction });
    }

    // ── Step 4: Insert holiday records for students with NO record yet ─────
    const markedEnrollmentIds = new Set(existingRecords.map(r => r.enrollment_id));
    const unmarkedEnrollments = enrollmentRows.filter(
      e => !markedEnrollmentIds.has(e.enrollment_id)
    );

    if (unmarkedEnrollments.length > 0) {
      const insertRows = unmarkedEnrollments.map(e => ({
        enrollment_id   : e.enrollment_id,
        date            : holidayDate,
        status          : 'holiday',
        method          : 'auto',
        marked_by       : declaredBy,
        marked_at       : new Date(),
        override_reason : `Holiday declared retroactively: "${holidayName}"`,
        created_at      : new Date(),
        updated_at      : new Date(),
      }));

      await sequelize.getQueryInterface().bulkInsert('attendance', insertRows, { transaction });
    }

    // ── Step 5: Recalculate percentages for all affected enrollments in BATCH ─
    // 5a. Efficiently calculate working days for all possible joined dates
    // Get session metadata for full range
    const [[sessionInfo]] = await sequelize.query(`
      SELECT start_date, end_date FROM sessions WHERE id = :sessionId LIMIT 1;
    `, { replacements: { sessionId }, transaction });
    
    const today = new Date().toISOString().split('T')[0];
    // FIX: normalize to plain YYYY-MM-DD strings (Sequelize may return Date objects)
    const sessionEndStr   = String(sessionInfo.end_date).slice(0, 10);
    const sessionStartStr = String(sessionInfo.start_date).slice(0, 10);
    const calcUpTo = today < sessionEndStr ? today : sessionEndStr;

    // Fetch config and all holidays for the entire session at once
    const [[workingDaysRow]] = await sequelize.query(`
      SELECT monday, tuesday, wednesday, thursday, friday, saturday, sunday
      FROM session_working_days WHERE session_id = :sessionId LIMIT 1;
    `, { replacements: { sessionId }, transaction });

    const [allHolidays] = await sequelize.query(`
      SELECT holiday_date FROM session_holidays 
      WHERE session_id = :sessionId AND holiday_date <= :calcUpTo;
    `, { replacements: { sessionId, calcUpTo }, transaction });
    // FIX: normalize holiday dates to strings to avoid Date-object set membership failures
    const holidaySet = new Set(allHolidays.map(h => String(h.holiday_date).slice(0, 10)));

    // Generate prefix sum of working days from session start to calcUpTo
    const fullDateRange = getDateRange(sessionStartStr, calcUpTo);
    const prefixSum = new Array(fullDateRange.length).fill(0);
    const dateToIndex = new Map();
    
    let currentSum = 0;
    fullDateRange.forEach((date, i) => {
      dateToIndex.set(date, i);
      const dayOfWeek = getDayOfWeek(date);
      const colName   = DAY_COLUMN_MAP[dayOfWeek];
      
      const isWorking = workingDaysRow[colName] && !holidaySet.has(date);
      if (isWorking) currentSum++;
      prefixSum[i] = currentSum;
    });

    const getWorkingDaysFast = (joinedDate) => {
      let startIndex = dateToIndex.get(joinedDate);
      
      if (startIndex === undefined) {
        // If joined before session starts, we start counting from the session start
        if (joinedDate < sessionStartStr) {
          startIndex = 0;
        } else {
          // Joined after calcUpTo
          return 0;
        }
      }

      const endIndex = fullDateRange.length - 1;
      
      // workingDays in [joinedDate, calcUpTo] = P[end] - P[start-1]
      const totalAtEnd = prefixSum[endIndex];
      const totalBeforeStart = startIndex > 0 ? prefixSum[startIndex - 1] : 0;
      return totalAtEnd - totalBeforeStart;
    };

    // 5b. Fetch status counts for all affected students in a single query
    const [allStatusCounts] = await sequelize.query(`
      SELECT a.enrollment_id, a.status, COUNT(*) AS count
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      WHERE a.enrollment_id IN (:enrollmentIds)
        AND a.date >= e.joined_date
        AND a.date <= :calcUpTo
        AND a.status != 'holiday'
      GROUP BY a.enrollment_id, a.status;
    `, { replacements: { enrollmentIds, calcUpTo }, transaction });
    
    // 5c. Pivot counts for easy lookup { enrollment_id -> { status: count } }
    const countLookup = new Map();
    allStatusCounts.forEach(r => {
      if (!countLookup.has(r.enrollment_id)) {
        countLookup.set(r.enrollment_id, { present: 0, late: 0, half_day: 0, absent: 0 });
      }
      const counts = countLookup.get(r.enrollment_id);
      if (counts.hasOwnProperty(r.status)) {
        counts[r.status] = parseInt(r.count, 10);
      }
    });

    // 5d. Perform in-memory calculation for each enrollment
    const oldRecordMap = new Map(existingRecords.map(r => [r.enrollment_id, r]));

    const affectedStudents = enrollmentRows.map(row => {
      const oldRecord = oldRecordMap.get(row.enrollment_id);
      const workingDays = getWorkingDaysFast(row.joined_date);
      const counts = countLookup.get(row.enrollment_id) || { present: 0, late: 0, half_day: 0, absent: 0 };

      let percentage = 0;
      let grade = 'N/A';

      if (workingDays > 0) {
        const effectivePresent =
          counts.present  * 1.0 +
          counts.late     * 1.0 +
          counts.half_day * 0.5;

        percentage = parseFloat(((effectivePresent / workingDays) * 100).toFixed(2));
        grade =
          percentage >= 90 ? 'A' :
          percentage >= 75 ? 'B' :
          percentage >= 60 ? 'C' :
          percentage >= 50 ? 'D' : 'F';
      }

      return {
        enrollmentId   : row.enrollment_id,
        studentId      : row.student_id,
        oldStatus      : oldRecord ? oldRecord.status : 'no_record',
        newPercentage  : percentage,
        newGrade       : grade,
      };
    });

    return {
      date             : holidayDate,
      affectedCount    : enrollmentRows.length,
      recordsUpdated   : existingRecords.length,
      recordsInserted  : unmarkedEnrollments.length,
      affectedStudents,
    };
  };

  if (t) {
    return execute(t);
  } else {
    return sequelize.transaction(execute);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 4: getAttendanceStatsForEnrollments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates attendance statistics for multiple enrollments in batch.
 * Mandates the prefix-sum algorithm of working days to ensure O(1) count per student.
 *
 * @param {number[]} enrollmentIds
 * @param {object} options
 * @param {string} [options.fromDate] 'YYYY-MM-DD' (optional)
 * @param {string} [options.toDate]   'YYYY-MM-DD' (optional)
 * @param {object} [t] sequelize transaction
 */
async function getAttendanceStatsForEnrollments(enrollmentIds, options = {}, t = null) {
  if (!enrollmentIds || enrollmentIds.length === 0) return [];

  // 1. Fetch enrollments and session dates
  const [enrollments] = await sequelize.query(`
    SELECT
      e.id AS enrollment_id,
      e.student_id,
      e.session_id,
      e.joined_date,
      e.left_date,
      s.start_date  AS session_start_date,
      s.end_date    AS session_end_date
    FROM enrollments e
    JOIN sessions    s ON s.id = e.session_id
    WHERE e.id IN (:enrollmentIds);
  `, { replacements: { enrollmentIds }, transaction: t });

  if (enrollments.length === 0) return [];

  // Group by session_id to batch query configs
  const sessionsMap = new Map();
  enrollments.forEach(e => {
    if (!sessionsMap.has(e.session_id)) {
      sessionsMap.set(e.session_id, []);
    }
    sessionsMap.get(e.session_id).push(e);
  });

  const allResults = [];

  for (const [sessionId, sessionEnrollments] of sessionsMap.entries()) {
    const sessionEnrollmentIds = sessionEnrollments.map(e => e.enrollment_id);

    // Fetch config and holidays
    const [[workingDaysRow]] = await sequelize.query(`
      SELECT monday, tuesday, wednesday, thursday, friday, saturday, sunday
      FROM session_working_days WHERE session_id = :sessionId LIMIT 1;
    `, { replacements: { sessionId }, transaction: t });

    if (!workingDaysRow) {
      throw { name: 'AttendanceConfigError', message: `No working_days config found for session_id=${sessionId}.`, status: 422 };
    }

    const [allHolidays] = await sequelize.query(`
      SELECT holiday_date FROM session_holidays 
      WHERE session_id = :sessionId;
    `, { replacements: { sessionId }, transaction: t });
    const holidaySet = new Set(allHolidays.map(h => String(h.holiday_date).slice(0, 10)));

    const sessionStartStr = String(sessionEnrollments[0].session_start_date).slice(0, 10);
    const sessionEndStr   = String(sessionEnrollments[0].session_end_date).slice(0, 10);

    // Generate prefix sum of working days from session start to session end
    const fullDateRange = getDateRange(sessionStartStr, sessionEndStr);
    const prefixSum = new Array(fullDateRange.length).fill(0);
    const dateToIndex = new Map();

    let currentSum = 0;
    fullDateRange.forEach((date, i) => {
      dateToIndex.set(date, i);
      const dayOfWeek = getDayOfWeek(date);
      const colName   = DAY_COLUMN_MAP[dayOfWeek];

      const isWorking = workingDaysRow[colName] && !holidaySet.has(date);
      if (isWorking) currentSum++;
      prefixSum[i] = currentSum;
    });

    const getWorkingDaysRange = (startD, endD) => {
      if (startD > endD) return 0;

      let startIndex = dateToIndex.get(startD);
      if (startIndex === undefined) {
        if (startD < sessionStartStr) {
          startIndex = 0;
        } else {
          return 0;
        }
      }

      let endIndex = dateToIndex.get(endD);
      if (endIndex === undefined) {
        if (endD > sessionEndStr) {
          endIndex = fullDateRange.length - 1;
        } else {
          return 0;
        }
      }

      if (startIndex > endIndex) return 0;

      const totalAtEnd = prefixSum[endIndex];
      const totalBeforeStart = startIndex > 0 ? prefixSum[startIndex - 1] : 0;
      return totalAtEnd - totalBeforeStart;
    };

    // Query status counts (do not exclude holidays so we can return holiday count)
    const today = new Date().toISOString().split('T')[0];
    const queryFrom = options.fromDate || sessionStartStr;
    const queryTo = options.toDate || sessionEndStr;

    const [statusCounts] = await sequelize.query(`
      SELECT a.enrollment_id, a.status, COUNT(*) AS count
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      WHERE a.enrollment_id IN (:sessionEnrollmentIds)
        AND a.date >= e.joined_date
        AND a.date >= :queryFrom
        AND a.date <= :queryTo
      GROUP BY a.enrollment_id, a.status;
    `, { replacements: { sessionEnrollmentIds, queryFrom, queryTo }, transaction: t });

    const countLookup = new Map();
    statusCounts.forEach(r => {
      if (!countLookup.has(r.enrollment_id)) {
        countLookup.set(r.enrollment_id, { present: 0, late: 0, half_day: 0, absent: 0, holiday: 0 });
      }
      const counts = countLookup.get(r.enrollment_id);
      if (counts.hasOwnProperty(r.status)) {
        counts[r.status] = parseInt(r.count, 10);
      }
    });

    sessionEnrollments.forEach(row => {
      const studentStart = row.joined_date > queryFrom ? row.joined_date : queryFrom;
      const leftDateStr = row.left_date ? String(row.left_date).slice(0, 10) : sessionEndStr;
      const calcUpTo = today < queryTo ? today : queryTo;
      const limitEnd = calcUpTo < sessionEndStr ? calcUpTo : sessionEndStr;
      const studentEnd = leftDateStr < limitEnd ? leftDateStr : limitEnd;

      const workingDays = getWorkingDaysRange(studentStart, studentEnd);
      const counts = countLookup.get(row.enrollment_id) || { present: 0, late: 0, half_day: 0, absent: 0, holiday: 0 };

      let percentage = 0;
      let grade = 'N/A';

      if (workingDays > 0) {
        const effectivePresent =
          counts.present  * 1.0 +
          counts.late     * 1.0 +
          counts.half_day * 0.5;

        percentage = parseFloat(((effectivePresent / workingDays) * 100).toFixed(2));
        grade =
          percentage >= 90 ? 'A' :
          percentage >= 75 ? 'B' :
          percentage >= 60 ? 'C' :
          percentage >= 50 ? 'D' : 'F';
      }

      allResults.push({
        enrollmentId: row.enrollment_id,
        studentId: row.student_id,
        sessionId: row.session_id,
        joinedDate: row.joined_date,
        calculatedUpTo: calcUpTo,
        workingDays,
        presentCount: counts.present,
        lateCount: counts.late,
        halfDayCount: counts.half_day,
        absentCount: counts.absent,
        holidayCount: counts.holiday,
        percentage,
        grade
      });
    });
  }

  return allResults;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 5: saveBulkAttendance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared service helper to handle bulk attendance marking.
 * Includes future-date rejection, holiday/leave checking, and override reason checks.
 */
async function saveBulkAttendance({
  sessionId,
  classId,
  sectionId,
  date,
  records,
  reason,
  markedBy,
  isTeacher = false,
  teacherLeaveCheck = null
}) {
  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Future date protection
  if (date > todayStr) {
    throw { name: 'ValidationError', message: 'Cannot mark attendance for a future date.', status: 422 };
  }

  // 2. Teacher leave validation
  if (teacherLeaveCheck) {
    throw { name: 'ValidationError', message: 'Cannot mark attendance. You are on approved leave for this date.', status: 422 };
  }

  // 3. Holiday validation
  const [[holiday]] = await sequelize.query(`
    SELECT name FROM session_holidays
    WHERE session_id = :sessionId AND holiday_date = :date LIMIT 1;
  `, { replacements: { sessionId, date } });

  if (holiday) {
    throw { name: 'ValidationError', message: `Cannot mark attendance. Selected date is a holiday: ${holiday.name}.`, status: 422 };
  }

  // 4. Working day validation
  const dayOfWeek = getDayOfWeek(date);
  const dayName = DAY_COLUMN_MAP[dayOfWeek];
  const [[workingDayConfig]] = await sequelize.query(`
    SELECT ${dayName} AS is_working FROM session_working_days
    WHERE session_id = :sessionId LIMIT 1;
  `, { replacements: { sessionId } });

  const isWorking = workingDayConfig ? workingDayConfig.is_working : (dayOfWeek !== 0);
  if (!isWorking) {
    throw { name: 'ValidationError', message: `Cannot mark attendance. Selected date (${date}) is not a working day.`, status: 422 };
  }

  // 5. Fetch existing rows to evaluate if reason is required
  const [existingRows] = await sequelize.query(`
    SELECT a.id, a.enrollment_id, a.status, a.previous_status
    FROM attendance a
    JOIN enrollments e ON e.id = a.enrollment_id
    WHERE a.date = :date
      AND e.session_id = :sessionId
      AND e.class_id = :classId
      AND e.section_id = :sectionId;
  `, { replacements: { date, sessionId, classId, sectionId } });

  const isPast = date < todayStr;
  const resolvedReason = reason ? reason.trim() : null;

  if (isPast || existingRows.length > 0) {
    if (!resolvedReason || resolvedReason.length < 10) {
      throw { name: 'ValidationError', message: 'Reason (minimum 10 characters) is required when editing existing or past attendance.', status: 422 };
    }
  }

  const existingMap = new Map(existingRows.map(row => [Number(row.enrollment_id), row]));
  const inserted = [];
  const updated = [];
  let skipped = 0;

  await sequelize.transaction(async (transaction) => {
    for (const record of records) {
      const eid = Number(record.enrollment_id);
      const existing = existingMap.get(eid);

      if (existing) {
        if (existing.status !== record.status) {
          await sequelize.query(`
            UPDATE attendance
            SET status = :status,
                method = 'manual',
                previous_status = :previousStatus,
                override_reason = :overrideReason,
                marked_by = :markedBy,
                marked_at = NOW(),
                updated_at = NOW()
            WHERE id = :id;
          `, {
            replacements: {
              id: existing.id,
              status: record.status,
              previousStatus: (existing.status === 'holiday' && existing.previous_status) ? existing.previous_status : existing.status,
              overrideReason: resolvedReason,
              markedBy,
            },
            transaction,
          });
          updated.push(eid);
        } else {
          skipped++;
        }
      } else {
        // Verify enrollment belongs to class/section/session
        const [[enrollment]] = await sequelize.query(`
          SELECT id FROM enrollments
          WHERE id = :eid AND class_id = :classId AND section_id = :sectionId AND session_id = :sessionId;
        `, { 
          replacements: { eid, classId, sectionId, sessionId },
          transaction
        });

        if (!enrollment) {
          skipped++;
          continue;
        }

        await sequelize.query(`
          INSERT INTO attendance (enrollment_id, date, status, method, marked_by, marked_at, override_reason, created_at, updated_at)
          VALUES (:enrollmentId, :date, :status, 'manual', :markedBy, NOW(), :overrideReason, NOW(), NOW());
        `, {
          replacements: {
            enrollmentId: eid,
            date,
            status: record.status,
            markedBy,
            overrideReason: isPast ? resolvedReason : null,
          },
          transaction,
        });
        inserted.push(eid);
      }
    }
  });

  return {
    insertedCount: inserted.length,
    updatedCount: updated.length,
    skippedCount: skipped,
    updatedEnrollmentIds: updated,
    editedExisting: existingRows.length > 0,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  getWorkingDays,
  getAttendancePercent,
  retroactiveHoliday,
  getAttendanceStatsForEnrollments,
  saveBulkAttendance,
  // Export helper for use in other modules
  _internal: { getDateRange, getDayOfWeek, DAY_COLUMN_MAP },
};
