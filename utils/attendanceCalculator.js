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
  const current = new Date(startDate);
  const end     = new Date(endDate);

  // Normalize to midnight UTC to prevent DST shifts
  current.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
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
 *
 * @returns {{
 *   workingDays   : number,
 *   workingDates  : string[],
 *   removedWeekends  : number,
 *   removedHolidays  : number,
 *   holidays      : Array<{ date: string, name: string }>
 * }}
 */
async function getWorkingDays(sessionId, fromDate, toDate) {
  // ── Fetch working day config for this session ────────────────────────────
  const [[workingDaysRow]] = await sequelize.query(`
    SELECT monday, tuesday, wednesday, thursday, friday, saturday, sunday
    FROM session_working_days
    WHERE session_id = :sessionId
    LIMIT 1;
  `, { replacements: { sessionId } });

  if (!workingDaysRow) {
    throw new Error(`No working_days config found for session_id=${sessionId}.`);
  }

  // ── Fetch all holidays in this session within the date range ─────────────
  const [holidayRows] = await sequelize.query(`
    SELECT holiday_date, name
    FROM session_holidays
    WHERE session_id  = :sessionId
      AND holiday_date >= :fromDate
      AND holiday_date <= :toDate
    ORDER BY holiday_date ASC;
  `, { replacements: { sessionId, fromDate, toDate } });

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
async function getAttendancePercent(enrollmentId) {
  // ── Fetch enrollment + session info ─────────────────────────────────────
  const [[enrollment]] = await sequelize.query(`
    SELECT
      e.id          AS enrollment_id,
      e.student_id,
      e.session_id,
      e.joined_date,
      s.end_date    AS session_end_date,
      s.status      AS session_status
    FROM enrollments e
    JOIN sessions    s ON s.id = e.session_id
    WHERE e.id = :enrollmentId;
  `, { replacements: { enrollmentId } });

  if (!enrollment) {
    throw new Error(`Enrollment id=${enrollmentId} not found.`);
  }

  // Calculate up to today or session end, whichever is earlier
  const today       = new Date().toISOString().split('T')[0];
  const sessionEnd  = enrollment.session_end_date;
  const calcUpTo    = today < sessionEnd ? today : sessionEnd;
  const fromDate    = enrollment.joined_date;

  // ── Get working days FROM joined_date ────────────────────────────────────
  const { workingDays, workingDates } = await getWorkingDays(
    enrollment.session_id,
    fromDate,
    calcUpTo
  );

  if (workingDays === 0) {
    return {
      enrollmentId,
      studentId       : enrollment.student_id,
      sessionId       : enrollment.session_id,
      joinedDate      : fromDate,
      calculatedUpTo  : calcUpTo,
      workingDays     : 0,
      presentCount    : 0,
      lateCount       : 0,
      halfDayCount    : 0,
      absentCount     : 0,
      effectivePresent: 0,
      percentage      : 0,
      grade           : 'N/A',
    };
  }

  // ── Fetch actual attendance records ──────────────────────────────────────
  const [records] = await sequelize.query(`
    SELECT status, COUNT(*) AS count
    FROM attendance
    WHERE enrollment_id = :enrollmentId
      AND date >= :fromDate
      AND date <= :calcUpTo
      AND status != 'holiday'
    GROUP BY status;
  `, { replacements: { enrollmentId, fromDate, calcUpTo } });

  // Build status count map
  const counts = { present: 0, late: 0, half_day: 0, absent: 0 };
  records.forEach(r => {
    if (counts.hasOwnProperty(r.status)) {
      counts[r.status] = parseInt(r.count, 10);
    }
  });

  // ── Apply weighting formula ──────────────────────────────────────────────
  const effectivePresent =
    counts.present  * 1.0 +
    counts.late     * 1.0 +    // Late = present for percentage purposes
    counts.half_day * 0.5;     // Half day = 0.5

  const percentage = parseFloat(
    ((effectivePresent / workingDays) * 100).toFixed(2)
  );

  // ── Assign letter grade ──────────────────────────────────────────────────
  const grade =
    percentage >= 90 ? 'A' :
    percentage >= 75 ? 'B' :
    percentage >= 60 ? 'C' :
    percentage >= 50 ? 'D' : 'F';

  return {
    enrollmentId,
    studentId       : enrollment.student_id,
    sessionId       : enrollment.session_id,
    joinedDate      : fromDate,
    calculatedUpTo  : calcUpTo,
    workingDays,
    presentCount    : counts.present,
    lateCount       : counts.late,
    halfDayCount    : counts.half_day,
    absentCount     : counts.absent,
    effectivePresent,
    percentage,
    grade,
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
 *
 * @returns {{
 *   date             : string,
 *   affectedCount    : number,
 *   affectedStudents : Array<{ enrollmentId, studentId, oldStatus, newPercentage }>
 * }}
 */
async function retroactiveHoliday(sessionId, holidayDate, holidayName, declaredBy) {
  return sequelize.transaction(async (t) => {

    // ── Step 1: Find all enrollment ids active in this session ───────────
    const [enrollmentRows] = await sequelize.query(`
      SELECT e.id AS enrollment_id, e.student_id
      FROM enrollments e
      WHERE e.session_id = :sessionId
        AND e.status     = 'active'
        AND e.joined_date <= :holidayDate;
    `, { replacements: { sessionId, holidayDate }, transaction: t });

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
    `, { replacements: { holidayDate, enrollmentIds }, transaction: t });

    const overrideReason =
      `Retroactive holiday declared: "${holidayName}" on ${holidayDate}. ` +
      `Original attendance overridden by system.`;

    // ── Step 3: Update existing records to holiday ────────────────────────
    if (existingRecords.length > 0) {
      const affectedIds = existingRecords.map(r => r.id);
      await sequelize.query(`
        UPDATE attendance
        SET
          status          = 'holiday',
          override_reason = :overrideReason,
          marked_by       = :declaredBy,
          marked_at       = NOW(),
          updated_at      = NOW()
        WHERE id IN (:affectedIds);
      `, { replacements: { overrideReason, declaredBy, affectedIds }, transaction: t });
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

      await sequelize.getQueryInterface().bulkInsert('attendance', insertRows, { transaction: t });
    }

    // ── Step 5: Recalculate percentages for all affected enrollments ──────
    const affectedStudents = [];

    for (const row of enrollmentRows) {
      const oldRecord = existingRecords.find(r => r.enrollment_id === row.enrollment_id);
      const newStats  = await getAttendancePercent(row.enrollment_id);

      affectedStudents.push({
        enrollmentId   : row.enrollment_id,
        studentId      : row.student_id,
        oldStatus      : oldRecord ? oldRecord.status : 'no_record',
        newPercentage  : newStats.percentage,
        newGrade       : newStats.grade,
      });
    }

    return {
      date             : holidayDate,
      affectedCount    : enrollmentRows.length,
      recordsUpdated   : existingRecords.length,
      recordsInserted  : unmarkedEnrollments.length,
      affectedStudents,
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  getWorkingDays,
  getAttendancePercent,
  retroactiveHoliday,
  // Export helper for use in other modules
  _internal: { getDateRange, getDayOfWeek, DAY_COLUMN_MAP },
};