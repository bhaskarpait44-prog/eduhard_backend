'use strict';

const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const sequelize = require('../config/database');
const redis = require('../config/redis');

const TODAY = () => new Date().toISOString().slice(0, 10);
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DEFAULT_LEAVE_BALANCES = [
  { leave_type: 'casual', total_allowed: Number(process.env.DEFAULT_CASUAL_LEAVE || 12) },
  { leave_type: 'sick', total_allowed: Number(process.env.DEFAULT_SICK_LEAVE || 10) },
  { leave_type: 'emergency', total_allowed: Number(process.env.DEFAULT_EMERGENCY_LEAVE || 5) },
  { leave_type: 'earned', total_allowed: Number(process.env.DEFAULT_EARNED_LEAVE || 15) },
];

const PRESENT_SQL = `
  CASE
    WHEN a.status IN ('present', 'late') THEN 1
    WHEN a.status = 'half_day' THEN 0.5
    ELSE 0
  END
`;

async function audit(tableName, recordId, changes, req) {
  const rows = (Array.isArray(changes) ? changes : [changes]).map((change) => ({
    table_name: tableName,
    record_id: recordId,
    field_name: change.field,
    old_value: change.oldValue != null ? String(change.oldValue) : null,
    new_value: change.newValue != null ? String(change.newValue) : null,
    changed_by: req.user?.id || null,
    reason: change.reason || null,
    ip_address: req.ip || null,
    device_info: (req.headers['user-agent'] || '').slice(0, 299),
    created_at: new Date(),
  }));

  if (rows.length > 0) {
    await sequelize.getQueryInterface().bulkInsert('audit_logs', rows);
  }
}

async function getCurrentSession(schoolId) {
  const [[session]] = await sequelize.query(`
    SELECT id, name, start_date, end_date, status, is_current
    FROM sessions
    WHERE school_id = :schoolId
    ORDER BY CASE WHEN is_current = true THEN 0 ELSE 1 END, start_date DESC
    LIMIT 1;
  `, { replacements: { schoolId } });

  return session || null;
}

async function getTeacherAssignments(teacherId, schoolId, sessionId) {
  const [assignments] = await sequelize.query(`
    SELECT
      ta.id,
      ta.session_id,
      ta.class_id,
      ta.section_id,
      ta.subject_id,
      ta.is_class_teacher,
      ta.is_active,
      c.name AS class_name,
      sec.name AS section_name,
      sub.name AS subject_name,
      sub.code AS subject_code
    FROM teacher_assignments ta
    JOIN sessions sess ON sess.id = ta.session_id
    JOIN classes c ON c.id = ta.class_id
    JOIN sections sec ON sec.id = ta.section_id
    LEFT JOIN subjects sub ON sub.id = ta.subject_id
    WHERE ta.teacher_id = :teacherId
      AND sess.school_id = :schoolId
      AND ta.is_active = true
      AND (:sessionId::int IS NULL OR ta.session_id = :sessionId);
  `, {
    replacements: {
      teacherId,
      schoolId,
      sessionId: sessionId || null,
    },
  });

  return assignments;
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(Boolean).map((value) => Number(value)))];
}

function buildScope(assignments) {
  return {
    assignments,
    classTeacherSections: new Set(
      assignments
        .filter((assignment) => assignment.is_class_teacher)
        .map((assignment) => `${assignment.class_id}:${assignment.section_id}`)
    ),
    subjectTeacherScopes: new Set(
      assignments
        .filter((assignment) => assignment.subject_id)
        .map((assignment) => `${assignment.class_id}:${assignment.section_id}:${assignment.subject_id}`)
    ),
    sectionIds: uniqueNumbers(assignments.map((assignment) => assignment.section_id)),
    classIds: uniqueNumbers(assignments.map((assignment) => assignment.class_id)),
    subjectIds: uniqueNumbers(assignments.map((assignment) => assignment.subject_id)),
  };
}

function getAccess(scope, classId, sectionId, subjectId = null) {
  const sectionKey = `${classId}:${sectionId}`;
  const hasClassTeacherAccess = scope.classTeacherSections.has(sectionKey);
  const hasSubjectAccess = subjectId
    ? scope.subjectTeacherScopes.has(`${classId}:${sectionId}:${subjectId}`)
    : scope.assignments.some((assignment) =>
        Number(assignment.class_id) === Number(classId) &&
        Number(assignment.section_id) === Number(sectionId) &&
        assignment.subject_id != null
      );

  return {
    allowed: hasClassTeacherAccess || hasSubjectAccess,
    isClassTeacher: hasClassTeacherAccess,
    isSubjectTeacher: hasSubjectAccess,
  };
}

function assertAccess(scope, classId, sectionId, subjectId = null) {
  const access = getAccess(scope, classId, sectionId, subjectId);
  if (!access.allowed) {
    const error = new Error('You are not assigned to this class, section, or subject.');
    error.status = 403;
    throw error;
  }
  return access;
}

function assertMarksAccess(scope, classId, sectionId, subjectId) {
  const access = getAccess(scope, classId, sectionId, subjectId);
  if (!access.isSubjectTeacher) {
    const error = new Error('Only the assigned subject teacher can enter or review marks for this subject.');
    error.status = 403;
    throw error;
  }
  return access;
}

async function assertAttendanceAccess(teacherId, classId, sectionId, date, scope) {
  const sectionKey = `${classId}:${sectionId}`;
  
  // 1. Check if they are the Class Teacher
  if (scope.classTeacherSections.has(sectionKey)) {
    return true;
  }

  // 2. Check if they are an Invigilator for this class on this specific day
  const [[invigilation]] = await sequelize.query(`
    SELECT es.id
    FROM exam_subjects es
    JOIN exams ex ON ex.id = es.exam_id
    WHERE ex.class_id = :classId
      AND es.invigilator_teacher_id = :teacherId
      AND es.exam_date = :date
    LIMIT 1;
  `, {
    replacements: { classId, teacherId, date },
  });

  if (invigilation) {
    return true;
  }

  const error = new Error('Access Restricted: Only the assigned Class Teacher or today\'s Invigilator is authorized to manage daily attendance for this section.');
  error.status = 403;
  throw error;
}

async function getEnrollmentByAttendanceId(attendanceId) {
  const [[record]] = await sequelize.query(`
    SELECT
      a.id,
      a.enrollment_id,
      a.date,
      a.status,
      a.override_reason,
      e.class_id,
      e.section_id
    FROM attendance a
    JOIN enrollments e ON e.id = a.enrollment_id
    WHERE a.id = :attendanceId;
  `, { replacements: { attendanceId } });

  return record || null;
}

async function syncExamStatus(examId, transaction = null) {
  const [[examMeta]] = await sequelize.query(`
    SELECT session_id, class_id, status
    FROM exams
    WHERE id = :examId
    LIMIT 1;
  `, {
    replacements: { examId },
    transaction,
  });

  if (!examMeta) return 'upcoming';
  if (['draft', 'published'].includes(examMeta.status)) return examMeta.status;

  const [[subjectRow]] = await sequelize.query(`
    SELECT COUNT(*) AS cnt
    FROM subjects
    WHERE class_id = :classId
      AND is_deleted = false;
  `, {
    replacements: { classId: examMeta.class_id },
    transaction,
  });

  const [[enrollmentRow]] = await sequelize.query(`
    SELECT COUNT(*) AS cnt
    FROM enrollments
    WHERE session_id = :sessionId
      AND class_id = :classId
      AND status = 'active';
  `, {
    replacements: {
      sessionId: examMeta.session_id,
      classId: examMeta.class_id,
    },
    transaction,
  });

  const [[entryRow]] = await sequelize.query(`
    SELECT COUNT(*) AS cnt
    FROM exam_results
    WHERE exam_id = :examId;
  `, {
    replacements: { examId },
    transaction,
  });

  const subjectCount = Number(subjectRow?.cnt || 0);
  const enrollmentCount = Number(enrollmentRow?.cnt || 0);
  const requiredEntries = subjectCount * enrollmentCount;
  const enteredEntries = Number(entryRow?.cnt || 0);
  const nextStatus = requiredEntries > 0 && enteredEntries >= requiredEntries ? 'completed' : 'ongoing';

  await sequelize.query(`
    UPDATE exams
    SET status = :status,
        updated_at = NOW()
    WHERE id = :examId;
  `, {
    replacements: {
      examId,
      status: nextStatus,
    },
    transaction,
  });

  return nextStatus;
}

async function getMarksReviewStatus(examId, subjectId) {
  const [[row]] = await sequelize.query(`
    SELECT review_status, submitted_at, reviewed_at
    FROM exam_subjects
    WHERE exam_id = :examId
      AND subject_id = :subjectId
    LIMIT 1;
  `, { replacements: { examId, subjectId } });

  const status = row?.review_status || 'draft';
  const labels = {
    draft: 'Draft',
    submitted: 'Submitted for review',
    approved: 'Approved',
    rejected: 'Rejected for correction',
  };

  return {
    status,
    label: labels[status] || 'Draft',
    submitted_at: row?.submitted_at || null,
    reviewed_at: row?.reviewed_at || null,
  };
}

async function getAccessibleStudent(scope, schoolId, studentId) {
  const [[student]] = await sequelize.query(`
    SELECT
      s.id,
      s.admission_no,
      s.first_name,
      s.last_name,
      s.date_of_birth,
      s.gender,
      s.created_at,
      e.id AS enrollment_id,
      e.class_id,
      e.section_id,
      e.session_id,
      e.roll_number,
      c.name AS class_name,
      sec.name AS section_name
    FROM students s
    JOIN enrollments e ON e.student_id = s.id
    JOIN classes c ON c.id = e.class_id
    JOIN sections sec ON sec.id = e.section_id
    WHERE s.id = :studentId
      AND s.school_id = :schoolId
      AND s.is_deleted = false
    ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.joined_date DESC, e.id DESC
    LIMIT 1;
  `, { replacements: { studentId, schoolId } });

  if (!student) {
    const error = new Error('Student not found.');
    error.status = 404;
    throw error;
  }

  const access = assertAccess(scope, student.class_id, student.section_id);
  return { student, access };
}

async function getTodayScheduleRows(teacherId, sessionId) {
  const today = new Date();
  const dayName = DAY_NAMES[today.getDay()];
  if (dayName === 'sunday') {
    return [];
  }

  const [rows] = await sequelize.query(`
    SELECT
      ts.id,
      ts.class_id,
      ts.section_id,
      ts.subject_id,
      ts.period_number,
      ts.start_time,
      ts.end_time,
      ts.room_number,
      c.name AS class_name,
      sec.name AS section_name,
      sub.name AS subject_name,
      sub.code AS subject_code
    FROM timetable_slots ts
    JOIN classes c ON c.id = ts.class_id
    JOIN sections sec ON sec.id = ts.section_id
    JOIN subjects sub ON sub.id = ts.subject_id
    JOIN teacher_assignments ta
      ON ta.session_id = ts.session_id
     AND ta.class_id = ts.class_id
     AND ta.section_id = ts.section_id
     AND ta.teacher_id = ts.teacher_id
     AND ta.subject_id = ts.subject_id
     AND ta.is_active = true
    WHERE ts.teacher_id = :teacherId
      AND ts.session_id = :sessionId
      AND ts.day_of_week = :dayName
      AND ts.is_active = true
    ORDER BY ts.start_time ASC, ts.period_number ASC;
  `, { replacements: { teacherId, sessionId, dayName } });

  return rows;
}

function decorateScheduleRows(rows) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return rows.map((row) => {
    const [startHour, startMinute] = String(row.start_time).slice(0, 5).split(':').map(Number);
    const [endHour, endMinute] = String(row.end_time).slice(0, 5).split(':').map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;

    let status = 'upcoming';
    if (currentMinutes >= start && currentMinutes < end) status = 'current';
    if (currentMinutes >= end) status = 'done';

    return { ...row, status };
  });
}

async function getRecentActivity(req) {
  const [rows] = await sequelize.query(`
    SELECT id, table_name, field_name, new_value, created_at
    FROM audit_logs
    WHERE changed_by = :teacherId
      AND table_name IN ('attendance', 'exam_results', 'student_remarks', 'teacher_notices', 'teacher_profile')
    ORDER BY created_at DESC
    LIMIT 5;
  `, { replacements: { teacherId: req.user.id } });

  return rows;
}

async function getPendingMarkCount(scope, sessionId, teacherId) {
  if (scope.sectionIds.length === 0 || scope.subjectIds.length === 0) return { pending_exams: 0, missing_students: 0 };

  const [[row]] = await sequelize.query(`
    SELECT
      COUNT(DISTINCT ex.id) AS pending_exams,
      COUNT(*) FILTER (WHERE er.id IS NULL) AS missing_students
    FROM exams ex
    JOIN enrollments e ON e.class_id = ex.class_id AND e.session_id = ex.session_id AND e.status = 'active'
    JOIN teacher_assignments ta
      ON ta.class_id = e.class_id
     AND ta.section_id = e.section_id
     AND ta.session_id = ex.session_id
     AND ta.teacher_id = :teacherId
     AND ta.is_active = true
     AND ta.subject_id IS NOT NULL
    LEFT JOIN exam_results er
      ON er.exam_id = ex.id
     AND er.enrollment_id = e.id
     AND er.subject_id = ta.subject_id
    WHERE ex.session_id = :sessionId;
  `, { replacements: { teacherId, sessionId } });

  return {
    pending_exams: Number(row?.pending_exams || 0),
    missing_students: Number(row?.missing_students || 0),
  };
}

function requireFields(payload, fields) {
  for (const field of fields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      const error = new Error(`${field} is required.`);
      error.status = 422;
      throw error;
    }
  }
}

function normalizeTeacherRemarkVisibility(visibility) {
  if (!visibility || visibility === 'private') return 'private';
  if (visibility === 'share_parent') return 'share_student';
  if (visibility === 'share_student') return 'share_student';
  return 'private';
}

async function getTeacherContext(req) {
  const session = await getCurrentSession(req.user.school_id);
  const assignments = await getTeacherAssignments(req.user.id, req.user.school_id, session?.id || null);
  const scope = buildScope(assignments);
  return { session, assignments, scope };
}

async function enrichAssignment(assignment, session) {
  const [[stats]] = await sequelize.query(`
    SELECT
      COUNT(*) AS student_count,
      COUNT(a.id) FILTER (WHERE a.date = :today) AS attendance_rows_today,
      ROUND(
        AVG(CASE WHEN a.status IN ('present', 'late') THEN 100 WHEN a.status = 'half_day' THEN 50 ELSE 0 END),
        2
      ) AS attendance_rate
    FROM enrollments e
    LEFT JOIN attendance a
      ON a.enrollment_id = e.id
     AND a.date BETWEEN :weekStart AND :today
    WHERE e.session_id = :sessionId
      AND e.status = 'active'
      AND e.class_id = :classId
      AND e.section_id = :sectionId;
  `, {
    replacements: {
      today: TODAY(),
      weekStart: TODAY(),
      sessionId: session?.id || 0,
      classId: assignment.class_id,
      sectionId: assignment.section_id,
    },
  });

  const [[below75]] = await sequelize.query(`
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT e.id, ROUND(SUM(${PRESENT_SQL}) / NULLIF(COUNT(a.id), 0) * 100, 2) AS pct
      FROM enrollments e
      LEFT JOIN attendance a ON a.enrollment_id = e.id
      WHERE e.session_id = :sessionId
        AND e.status = 'active'
        AND e.class_id = :classId
        AND e.section_id = :sectionId
      GROUP BY e.id
    ) x
    WHERE x.pct < 75;
  `, {
    replacements: {
      sessionId: session?.id || 0,
      classId: assignment.class_id,
      sectionId: assignment.section_id,
    },
  });

  const [[feeDefaulters]] = await sequelize.query(`
    SELECT COUNT(DISTINCT fi.enrollment_id) AS cnt
    FROM fee_invoices fi
    JOIN enrollments e ON e.id = fi.enrollment_id
    WHERE e.session_id = :sessionId
      AND e.class_id = :classId
      AND e.section_id = :sectionId
      AND fi.status IN ('pending', 'partial');
  `, {
    replacements: {
      sessionId: session?.id || 0,
      classId: assignment.class_id,
      sectionId: assignment.section_id,
    },
  });

  const [[pendingRemarks]] = await sequelize.query(`
    SELECT COUNT(*) AS cnt
    FROM student_remarks sr
    JOIN enrollments e ON e.id = sr.enrollment_id
    WHERE e.session_id = :sessionId
      AND e.class_id = :classId
      AND e.section_id = :sectionId
      AND sr.is_deleted = false;
  `, {
    replacements: {
      sessionId: session?.id || 0,
      classId: assignment.class_id,
      sectionId: assignment.section_id,
    },
  });

  return {
    ...assignment,
    student_count: Number(stats?.student_count || 0),
    today_attendance_marked: Number(stats?.attendance_rows_today || 0) > 0,
    attendance_rate: Number(stats?.attendance_rate || 0),
    below_75_count: Number(below75?.cnt || 0),
    fee_defaulters_count: Number(feeDefaulters?.cnt || 0),
    pending_remarks_count: Number(pendingRemarks?.cnt || 0),
  };
}

function validateHomeworkPayload(payload, { partial = false } = {}) {
  const allowedSubmissionTypes = new Set(['written', 'online', 'both']);
  const requiredFields = ['class_id', 'section_id', 'subject_id', 'title', 'description', 'due_date', 'submission_type'];

  if (!partial) {
    requireFields(payload, requiredFields);
  }

  if (payload.submission_type != null && !allowedSubmissionTypes.has(payload.submission_type)) {
    const error = new Error('submission_type must be written, online, or both.');
    error.status = 422;
    throw error;
  }

  if (payload.max_marks != null && Number(payload.max_marks) < 0) {
    const error = new Error('max_marks cannot be negative.');
    error.status = 422;
    throw error;
  }
}

async function getOwnedHomeworkForTeacher(homeworkId, teacherId) {
  const [[homework]] = await sequelize.query(`
    SELECT h.*, c.name AS class_name, sec.name AS section_name, sub.name AS subject_name
    FROM homework h
    JOIN classes c ON c.id = h.class_id
    JOIN sections sec ON sec.id = h.section_id
    JOIN subjects sub ON sub.id = h.subject_id
    WHERE h.id = :homeworkId
      AND h.teacher_id = :teacherId
    LIMIT 1;
  `, { replacements: { homeworkId, teacherId } });

  return homework || null;
}

async function ensureHomeworkPendingRows(homeworkId, homework) {
  await sequelize.query(`
    INSERT INTO homework_submissions (
      homework_id,
      enrollment_id,
      submitted_at,
      submission_content,
      attachment_path,
      marks_obtained,
      teacher_comment,
      is_late,
      status,
      created_at
    )
    SELECT
      :homeworkId,
      e.id,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      false,
      'pending',
      NOW()
    FROM enrollments e
    WHERE e.class_id = :classId
      AND e.section_id = :sectionId
      AND e.session_id = :sessionId
      AND e.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM homework_submissions hs
        WHERE hs.homework_id = :homeworkId
          AND hs.enrollment_id = e.id
      );
  `, {
    replacements: {
      homeworkId,
      classId: homework.class_id,
      sectionId: homework.section_id,
      sessionId: homework.session_id,
    },
  });
}

function validateNoticePayload(payload, { partial = false } = {}) {
  const allowedCategories = new Set(['general', 'homework', 'exam', 'event', 'holiday', 'other', 'fee']);
  const allowedScopes = new Set(['my_class_only', 'specific_section', 'specific_student', 'all_students', 'specific_subject', 'whole_class', 'teachers', 'whole_school']);

  if (!partial) {
    requireFields(payload, ['title', 'content', 'target_scope']);
  }

  if (payload.category != null && !allowedCategories.has(payload.category)) {
    const error = new Error('category is invalid.');
    error.status = 422;
    throw error;
  }

  if (payload.target_scope != null && !allowedScopes.has(payload.target_scope)) {
    const error = new Error('Invalid target scope.');
    error.status = 422;
    throw error;
  }

  if (payload.expiry_date && payload.publish_date) {
    const expiry = new Date(payload.expiry_date).toISOString().slice(0, 10);
    const publish = new Date(payload.publish_date).toISOString().slice(0, 10);
    if (expiry < publish) {
      const error = new Error('expiry_date cannot be earlier than publish_date.');
      error.status = 422;
      throw error;
    }
  }
}

async function getAccessibleNoticeForTeacher(noticeId, req, scope) {
  const classTeacherPairs = [...scope.classTeacherSections];

  const tupleClause = classTeacherPairs.length
    ? classTeacherPairs.map((_, index) => `(:noticeClassId${index}, :noticeSectionId${index})`).join(', ')
    : '(NULL, NULL)';

  const replacements = {
    noticeId,
    teacherId: req.user.id,
    sectionIds: scope.sectionIds.length ? scope.sectionIds : [-1],
    ...Object.fromEntries(
      classTeacherPairs.flatMap((key, index) => {
        const [classId, sectionId] = key.split(':');
        return [[`noticeClassId${index}`, Number(classId)], [`noticeSectionId${index}`, Number(sectionId)]];
      })
    ),
  };

  const [[notice]] = await sequelize.query(`
    SELECT n.*
    FROM teacher_notices n
    WHERE n.id = :noticeId
      AND n.is_active = true
      AND (
        n.teacher_id = :teacherId
        OR n.target_scope = 'teachers'
        OR n.target_scope = 'whole_school'
        OR (n.target_scope = 'specific_teacher' AND n.target_teacher_id = :teacherId)
        OR (n.target_scope IN ('my_class_only', 'whole_class') AND (n.class_id, n.section_id) IN (${tupleClause}))
        OR (n.target_scope = 'specific_section' AND n.section_id IN (:sectionIds))
      )
    LIMIT 1;
  `, { replacements });

  return notice || null;
}

function eachDate(fromDate, toDate) {
  const dates = [];
  const current = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

async function getSessionCalendar(sessionId) {
  const [[workingDays]] = await sequelize.query(`
    SELECT monday, tuesday, wednesday, thursday, friday, saturday, sunday
    FROM session_working_days
    WHERE session_id = :sessionId
    LIMIT 1;
  `, { replacements: { sessionId } });

  const [holidays] = await sequelize.query(`
    SELECT holiday_date, name, type
    FROM session_holidays
    WHERE session_id = :sessionId;
  `, { replacements: { sessionId } });

  return {
    workingDays: workingDays || {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
    },
    holidays,
  };
}

function computeLeaveDays(fromDate, toDate, workingDays, holidays) {
  const dayNames = DAY_NAMES;
  const holidaySet = new Set(holidays.map((holiday) => String(holiday.holiday_date).slice(0, 10)));

  const dates = eachDate(fromDate, toDate);
  const applicableDates = dates.filter((dateString) => {
    const date = new Date(`${dateString}T00:00:00`);
    const dayName = dayNames[date.getDay()];
    return Boolean(workingDays?.[dayName]) && !holidaySet.has(dateString);
  });

  return {
    dates,
    applicableDates,
    daysCount: applicableDates.length,
  };
}

async function ensureTeacherLeaveBalances(teacherId, sessionId) {
  if (!teacherId || !sessionId) return;

  for (const balance of DEFAULT_LEAVE_BALANCES) {
    const totalAllowed = Number.isFinite(balance.total_allowed) ? balance.total_allowed : 0;
    await sequelize.query(`
      INSERT INTO leave_balances (
        teacher_id, session_id, leave_type, total_allowed, used, remaining, created_at, updated_at
      )
      VALUES (
        :teacherId, :sessionId, :leaveType, :totalAllowed, 0, :totalAllowed, NOW(), NOW()
      )
      ON CONFLICT (teacher_id, session_id, leave_type) DO NOTHING;
    `, {
      replacements: {
        teacherId,
        sessionId,
        leaveType: balance.leave_type,
        totalAllowed,
      },
    });
  }
}

exports.dashboard = async (req, res, next) => {
  try {
    const { session, assignments, scope } = await getTeacherContext(req);
    const today = TODAY();
    const teacherId = req.user.id;
    const sessionId = session?.id || 0;

    const schedule = decorateScheduleRows(await getTodayScheduleRows(teacherId, sessionId));
    const recentActivity = await getRecentActivity(req);
    const pendingMarks = await getPendingMarkCount(scope, sessionId, teacherId);

    const classTeacherAssignments = assignments.filter((assignment) => assignment.is_class_teacher);
    const subjectAssignments = assignments.filter((assignment) => !assignment.is_class_teacher);

    const myClass = await Promise.all(classTeacherAssignments.map((a) => enrichAssignment(a, session)));
    const subjectClasses = await Promise.all(subjectAssignments.map((a) => enrichAssignment(a, session)));

    // Attendance Status: Include assigned classes + invigilation duties today
    const [attendanceRows] = await sequelize.query(`
      WITH teacher_scopes AS (
        SELECT class_id, section_id FROM teacher_assignments
        WHERE teacher_id = :teacherId AND session_id = :sessionId AND is_active = true
        UNION
        SELECT ex.class_id, sec.id AS section_id
        FROM exam_subjects es
        JOIN exams ex ON ex.id = es.exam_id
        JOIN sections sec ON sec.class_id = ex.class_id
        WHERE es.invigilator_teacher_id = :teacherId AND es.exam_date = :today AND ex.session_id = :sessionId
      )
      SELECT
        COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN e.section_id ELSE NULL END) AS marked,
        COUNT(DISTINCT e.section_id) AS total,
        SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
        ROUND(
          (SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) + SUM(CASE WHEN a.status = 'half_day' THEN 1 ELSE 0 END) * 0.5)
          / NULLIF(COUNT(a.id), 0) * 100,
          2
        ) AS percentage
      FROM teacher_scopes ts
      JOIN enrollments e ON e.class_id = ts.class_id AND e.section_id = ts.section_id AND e.session_id = :sessionId AND e.status = 'active'
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = :today;
    `, { replacements: { today, sessionId, teacherId: req.user.id } });

    const attendanceRow = attendanceRows[0];
    const attendanceStatus = {
      marked: Number(attendanceRow?.marked || 0),
      total: Number(attendanceRow?.total || 0),
    };

    const studentToday = {
      present: Number(attendanceRow?.present || 0),
      absent: Number(attendanceRow?.absent || 0),
      percentage: Number(attendanceRow?.percentage || 0),
    };

    const nextPeriod = schedule.find((item) => item.status === 'current' || item.status === 'upcoming') || null;

    const classTeacherPairs = [...scope.classTeacherSections];
    const tupleClause = classTeacherPairs.length > 0
      ? classTeacherPairs.map((_, index) => `(:classId${index}, :sectionId${index})`).join(', ')
      : '(NULL, NULL)';

    const replacements = {
      sessionId,
      teacherId: req.user.id,
      ...Object.fromEntries(
        classTeacherPairs.flatMap((key, index) => {
          const [classId, sectionId] = key.split(':');
          return [[`classId${index}`, Number(classId)], [`sectionId${index}`, Number(sectionId)]];
        })
      ),
    };

    // Fetch upcoming exams/duties for dashboard
    const [upcomingExams] = await sequelize.query(`
      SELECT DISTINCT
        ex.id AS exam_id,
        ex.name AS exam_name,
        ex.exam_type,
        es.exam_date,
        es.start_time,
        es.end_time,
        sub.name AS subject_name,
        c.name AS class_name
      FROM exams ex
      JOIN exam_subjects es ON es.exam_id = ex.id
      JOIN subjects sub ON sub.id = es.subject_id
      JOIN classes c ON c.id = ex.class_id
      JOIN sections sec ON sec.class_id = ex.class_id
      LEFT JOIN teacher_assignments ta
        ON ta.session_id = ex.session_id
       AND ta.class_id = ex.class_id
       AND ta.section_id = sec.id
       AND ta.subject_id = es.subject_id
       AND ta.teacher_id = :teacherId
       AND ta.is_active = true
      WHERE (:sessionId::int IS NULL OR ex.session_id = :sessionId)
        AND ex.status IN ('draft', 'published', 'upcoming', 'ongoing')
        AND es.exam_date >= CURRENT_DATE
        AND (
          es.invigilator_teacher_id = :teacherId 
          OR ta.id IS NOT NULL
          OR (ex.class_id, sec.id) IN (${tupleClause})
        )
      ORDER BY es.exam_date ASC, es.start_time ASC
      LIMIT 5;
    `, { replacements });

    res.ok({
      teacher: { id: req.user.id, name: req.user.name },
      date: today,
      current_session: session,
      today_at_a_glance: {
        todays_classes: {
          total_periods: schedule.length,
          next_period: nextPeriod,
        },
        attendance_status: attendanceStatus,
        pending_marks: pendingMarks,
        my_students_today: studentToday,
      },
      today_schedule: schedule,
      recent_activity: recentActivity,
      my_class: myClass,
      subject_classes: subjectClasses,
      upcoming_exams: upcomingExams,
    }, 'Teacher dashboard loaded.');
  } catch (err) { next(err); }
};

exports.todaySchedule = async (req, res, next) => {
  try {
    const { session } = await getTeacherContext(req);
    const rows = decorateScheduleRows(await getTodayScheduleRows(req.user.id, session?.id));
    res.ok({ schedule: rows }, `${rows.length} period(s) found for today.`);
  } catch (err) { next(err); }
};

exports.pendingTasks = async (req, res, next) => {
  try {
    const { session, scope } = await getTeacherContext(req);
    const today = TODAY();
    const teacherId = req.user.id;
    const sessionId = session?.id || 0;
    const tasks = [];

    // Combined section list for attendance check: assigned + invigilator today
    const [sectionRows] = await sequelize.query(`
      SELECT class_id, section_id FROM teacher_assignments
      WHERE teacher_id = :teacherId AND session_id = :sessionId AND is_active = true
      UNION
      SELECT ex.class_id, sec.id AS section_id
      FROM exam_subjects es
      JOIN exams ex ON ex.id = es.exam_id
      JOIN sections sec ON sec.class_id = ex.class_id
      WHERE es.invigilator_teacher_id = :teacherId AND es.exam_date = :today AND ex.session_id = :sessionId
    `, { replacements: { teacherId, sessionId, today } });

    if (sectionRows.length > 0) {
      const [attendancePending] = await sequelize.query(`
        SELECT DISTINCT
          e.class_id,
          e.section_id,
          c.name AS class_name,
          sec.name AS section_name
        FROM enrollments e
        JOIN classes c ON c.id = e.class_id
        JOIN sections sec ON sec.id = e.section_id
        LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = :today
        WHERE e.session_id = :sessionId
          AND e.status = 'active'
          AND (e.class_id, e.section_id) IN (${sectionRows.map((_, i) => `(:c${i}, :s${i})`).join(', ')})
        GROUP BY e.class_id, e.section_id, c.name, sec.name
        HAVING COUNT(a.id) < COUNT(e.id);
      `, {
        replacements: {
          today,
          sessionId,
          ...Object.fromEntries(sectionRows.flatMap((r, i) => [[`c${i}`, r.class_id], [`s${i}`, r.section_id]])),
        },
      });

      attendancePending.forEach((row) => {
        tasks.push({
          type: 'attendance_pending',
          class_id: row.class_id,
          section_id: row.section_id,
          message: `Attendance not marked for ${row.class_name} ${row.section_name}`,
        });
      });
    }

    const pendingMarks = await getPendingMarkCount(scope, sessionId, teacherId);
    if (pendingMarks.pending_exams > 0) {
      tasks.push({
        type: 'marks_pending',
        pending_exams: pendingMarks.pending_exams,
        missing_students: pendingMarks.missing_students,
        message: `${pendingMarks.missing_students} mark entry slot(s) are still pending.`,
      });
    }

    const [belowThreshold] = scope.sectionIds.length > 0
      ? await sequelize.query(`
          SELECT COUNT(*) AS cnt
          FROM (
            SELECT
              e.id,
              ROUND(SUM(${PRESENT_SQL}) / NULLIF(COUNT(a.id), 0) * 100, 2) AS attendance_pct
            FROM enrollments e
            LEFT JOIN attendance a ON a.enrollment_id = e.id
            WHERE e.session_id = :sessionId
              AND e.status = 'active'
              AND e.section_id IN (:sectionIds)
            GROUP BY e.id
          ) t
          WHERE t.attendance_pct < 75;
        `, {
          replacements: {
            sessionId: session?.id || 0,
            sectionIds: scope.sectionIds.length ? scope.sectionIds : [-1],
          },
        })
      : [[{ cnt: 0 }]];

    if (Number(belowThreshold?.cnt || 0) > 0) {
      tasks.push({
        type: 'attendance_threshold',
        count: Number(belowThreshold.cnt),
        message: `${belowThreshold.cnt} student(s) are below 75% attendance.`,
      });
    }

    res.ok({ tasks }, `${tasks.length} pending task(s) found.`);
  } catch (err) { next(err); }
};

exports.recentActivity = async (req, res, next) => {
  try {
    const rows = await getRecentActivity(req);
    res.ok({ activity: rows }, `${rows.length} recent activity item(s) found.`);
  } catch (err) { next(err); }
};

exports.myClasses = async (req, res, next) => {
  try {
    const { session, assignments } = await getTeacherContext(req);
    const classTeacherAssignments = assignments.filter((assignment) => assignment.is_class_teacher);
    const subjectAssignments = assignments.filter((assignment) => !assignment.is_class_teacher);

    const myClass = await Promise.all(classTeacherAssignments.map((a) => enrichAssignment(a, session)));
    const subjectClasses = await Promise.all(subjectAssignments.map((a) => enrichAssignment(a, session)));

    res.ok({ my_class: myClass, subject_classes: subjectClasses }, 'Teacher classes loaded.');
  } catch (err) { next(err); }
};

exports.myClassOverview = async (req, res, next) => {
  try {
    const assignmentId = Number(req.params.id);
    const { session, assignments } = await getTeacherContext(req);
    const assignment = assignments.find((item) => Number(item.id) === assignmentId);

    if (!assignment) return res.fail('Assignment not found.', [], 404);

    const [students] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.roll_number,
        s.id AS student_id,
        s.admission_no,
        s.first_name,
        s.last_name
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
      ORDER BY COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer, e.roll_number;
    `, {
      replacements: {
        sessionId: session?.id || 0,
        classId: assignment.class_id,
        sectionId: assignment.section_id,
      },
    });

    // Check online status in Redis
    const studentsWithOnlineStatus = await Promise.all(students.map(async (student) => {
      let is_online = false;
      if (redis.status === 'ready') {
        const key = `online:${req.user.school_id}:student:${student.student_id}`;
        const val = await redis.get(key);
        is_online = val === '1';
      }
      return { ...student, is_online };
    }));

    res.ok({ assignment, students: studentsWithOnlineStatus }, `${studentsWithOnlineStatus.length} student(s) found in class overview.`);
  } catch (err) { next(err); }
};

exports.attendanceStatus = async (req, res, next) => {
  try {
    const { session, scope } = await getTeacherContext(req);
    const today = TODAY();
    const sessionId = session?.id || 0;

    const [rows] = await sequelize.query(`
      WITH teacher_scopes AS (
        -- Classes where teacher has an assignment
        SELECT class_id, section_id
        FROM teacher_assignments
        WHERE teacher_id = :teacherId
          AND session_id = :sessionId
          AND is_active = true
        
        UNION
        
        -- Classes where teacher is an invigilator today
        -- Note: exam_subjects is per class, so we join with all sections of that class
        SELECT ex.class_id, sec.id AS section_id
        FROM exam_subjects es
        JOIN exams ex ON ex.id = es.exam_id
        JOIN sections sec ON sec.class_id = ex.class_id
        WHERE es.invigilator_teacher_id = :teacherId
          AND es.exam_date = :today
          AND ex.session_id = :sessionId
      )
      SELECT
        ts.class_id,
        ts.section_id,
        c.name AS class_name,
        sec.name AS section_name,
        COUNT(DISTINCT e.id) AS total_students,
        COUNT(DISTINCT a.enrollment_id) AS marked_students,
        EXISTS(
          SELECT 1 FROM teacher_assignments ta
          WHERE ta.teacher_id = :teacherId
            AND ta.class_id = ts.class_id
            AND ta.section_id = ts.section_id
            AND ta.is_class_teacher = true
            AND ta.is_active = true
            AND ta.session_id = :sessionId
        ) AS is_class_teacher,
        EXISTS(
          SELECT 1 FROM exam_subjects es
          JOIN exams ex ON ex.id = es.exam_id
          WHERE es.invigilator_teacher_id = :teacherId
            AND ex.class_id = ts.class_id
            AND es.exam_date = :today
            AND ex.session_id = :sessionId
        ) AS is_invigilator_today
      FROM teacher_scopes ts
      JOIN classes c ON c.id = ts.class_id
      JOIN sections sec ON sec.id = ts.section_id
      JOIN enrollments e ON e.class_id = ts.class_id AND e.section_id = ts.section_id AND e.session_id = :sessionId AND e.status = 'active'
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = :today
      GROUP BY ts.class_id, ts.section_id, c.name, sec.name
      ORDER BY c.name, sec.name;
    `, {
      replacements: {
        today,
        sessionId,
        teacherId: req.user.id,
      },
    });

    res.ok({ classes: rows }, `${rows.length} attendance status row(s) found.`);
  } catch (err) { next(err); }
};

exports.attendanceStudents = async (req, res, next) => {
  try {
    const { class_id, section_id, date = TODAY(), subject_id = null } = req.query;
    requireFields(req.query, ['class_id', 'section_id']);

    const { session, scope } = await getTeacherContext(req);
    await assertAttendanceAccess(req.user.id, Number(class_id), Number(section_id), date, scope);
    const access = getAccess(scope, Number(class_id), Number(section_id), subject_id ? Number(subject_id) : null);

    const [students] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.roll_number,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        sp.photo_path,
        a.id AS attendance_id,
        a.status,
        a.override_reason
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = :date
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
      ORDER BY COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer, e.roll_number, s.first_name;
    `, {
      replacements: {
        date,
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
      },
    });

    const [[holiday]] = await sequelize.query(`
      SELECT id, name
      FROM session_holidays
      WHERE session_id = :sessionId
        AND holiday_date = :date
      LIMIT 1;
    `, { replacements: { sessionId: session?.id || 0, date } });

    const alreadyMarked = students.some((student) => student.attendance_id);

    res.ok({
      access,
      date,
      class_id: Number(class_id),
      section_id: Number(section_id),
      subject_id: subject_id ? Number(subject_id) : null,
      is_holiday: !!holiday,
      holiday,
      already_marked: alreadyMarked,
      requires_reason: date < TODAY() || alreadyMarked,
      students: students.map((student) => ({
        ...student,
        status: student.status || 'present',
      })),
    }, `${students.length} student(s) loaded for attendance.`);
  } catch (err) { next(err); }
};

exports.markAttendance = async (req, res, next) => {
  try {
    const { class_id, section_id, date = TODAY(), subject_id = null, records = [], reason = null } = req.body;
    requireFields(req.body, ['class_id', 'section_id']);

    const { session, scope } = await getTeacherContext(req);
    await assertAttendanceAccess(req.user.id, Number(class_id), Number(section_id), date, scope);
    const access = getAccess(scope, Number(class_id), Number(section_id), subject_id ? Number(subject_id) : null);
    const isPast = date < TODAY();

    const [existingRows] = await sequelize.query(`
      SELECT a.id, a.enrollment_id, a.status
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      WHERE a.date = :date
        AND e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId;
    `, {
      replacements: {
        date,
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
      },
    });

    if ((isPast || existingRows.length > 0) && !reason) {
      return res.fail('Reason is required when editing existing or past attendance.', [], 422);
    }

    const existingMap = new Map(existingRows.map((row) => [Number(row.enrollment_id), row]));
    const submittedRecords = records.length > 0 ? records : [];

    await sequelize.transaction(async (transaction) => {
      for (const record of submittedRecords) {
        const existing = existingMap.get(Number(record.enrollment_id));

        if (existing) {
          await sequelize.query(`
            UPDATE attendance
            SET status = :status,
                override_reason = :overrideReason,
                marked_by = :markedBy,
                marked_at = NOW(),
                updated_at = NOW()
            WHERE id = :id;
          `, {
            replacements: {
              id: existing.id,
              status: record.status || 'present',
              overrideReason: reason,
              markedBy: req.user.id,
            },
            transaction,
          });
        } else {
          await sequelize.query(`
            INSERT INTO attendance (enrollment_id, date, status, method, marked_by, marked_at, override_reason, created_at, updated_at)
            VALUES (:enrollmentId, :date, :status, 'manual', :markedBy, NOW(), :overrideReason, NOW(), NOW());
          `, {
            replacements: {
              enrollmentId: record.enrollment_id,
              date,
              status: record.status || 'present',
              markedBy: req.user.id,
              overrideReason: isPast ? reason : null,
            },
            transaction,
          });
        }
      }
    });

    await audit('attendance', Number(class_id), {
      field: 'teacher_mark',
      oldValue: existingRows.length ? 'existing' : null,
      newValue: `${submittedRecords.length} records`,
      reason: reason || `Attendance marked for ${date}${subject_id ? ` subject ${subject_id}` : ''}`,
    }, req);

    res.ok({
      class_id: Number(class_id),
      section_id: Number(section_id),
      subject_id: subject_id ? Number(subject_id) : null,
      date,
      access,
      processed: submittedRecords.length,
      edited_existing: existingRows.length > 0,
    }, 'Attendance saved successfully.');
  } catch (err) { next(err); }
};

exports.bulkMarkAttendance = async (req, res, next) => {
  return exports.markAttendance(req, res, next);
};

exports.updateAttendance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    requireFields(req.body, ['status', 'reason']);

    const { scope } = await getTeacherContext(req);
    const record = await getEnrollmentByAttendanceId(Number(id));
    if (!record) return res.fail('Attendance record not found.', [], 404);

    assertClassTeacherAccess(scope, record.class_id, record.section_id);

    await sequelize.query(`
      UPDATE attendance
      SET status = :status,
          override_reason = :reason,
          marked_by = :teacherId,
          marked_at = NOW(),
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        status,
        reason,
        teacherId: req.user.id,
      },
    });

    await audit('attendance', Number(id), {
      field: 'status',
      oldValue: record.status,
      newValue: status,
      reason,
    }, req);

    res.ok({ id: Number(id), status }, 'Attendance updated successfully.');
  } catch (err) { next(err); }
};

exports.attendanceRegister = async (req, res, next) => {
  try {
    const { class_id, section_id, month, year } = req.query;
    requireFields(req.query, ['class_id', 'section_id', 'month', 'year']);

    const { session, scope } = await getTeacherContext(req);
    assertAccess(scope, Number(class_id), Number(section_id));

    const monthNum = Number(month);
    const yearNum = Number(year);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.fail('month must be between 1 and 12.', [], 422);
    }
    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
      return res.fail('year must be a valid 4-digit year.', [], 422);
    }

    const fromDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const toDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [rows] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.roll_number,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'attendance_id', a.id,
              'date', a.date,
              'status', a.status,
              'reason', a.override_reason
            )
            ORDER BY a.date
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) AS records,
        ROUND(SUM(${PRESENT_SQL}) / NULLIF(COUNT(a.id), 0) * 100, 2) AS attendance_percentage
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN attendance a
        ON a.enrollment_id = e.id
       AND a.date BETWEEN :fromDate AND :toDate
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
      GROUP BY e.id, e.roll_number, s.id, s.first_name, s.last_name
      ORDER BY COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer, e.roll_number;
    `, {
      replacements: {
        fromDate,
        toDate,
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
      },
    });

    res.ok({
      month: monthNum,
      year: yearNum,
      students: rows,
    }, `${rows.length} student(s) found in attendance register.`);
  } catch (err) { next(err); }
};

exports.attendanceSummaryReport = async (req, res, next) => {
  try {
    const { class_id, section_id, from = TODAY(), to = TODAY() } = req.query;
    requireFields(req.query, ['class_id', 'section_id']);

    const { session, scope } = await getTeacherContext(req);
    assertAccess(scope, Number(class_id), Number(section_id));

    const [rows] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.roll_number,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        COUNT(a.id) AS total_days,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN a.status = 'half_day' THEN 1 ELSE 0 END) AS half_day,
        ROUND(SUM(${PRESENT_SQL}) / NULLIF(COUNT(a.id), 0) * 100, 2) AS percentage
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date BETWEEN :fromDate AND :toDate
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
      GROUP BY e.id, e.roll_number, s.id, s.first_name, s.last_name
      ORDER BY percentage ASC NULLS LAST, e.roll_number;
    `, {
      replacements: {
        fromDate: from,
        toDate: to,
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
      },
    });

    res.ok({ students: rows, from, to }, `${rows.length} attendance summary row(s) found.`);
  } catch (err) { next(err); }
};

exports.attendanceBelowThresholdReport = async (req, res, next) => {
  try {
    const { class_id, section_id, from = TODAY(), to = TODAY(), threshold = 75 } = req.query;
    requireFields(req.query, ['class_id', 'section_id']);

    const { session, scope } = await getTeacherContext(req);
    assertAccess(scope, Number(class_id), Number(section_id));

    const [rows] = await sequelize.query(`
      SELECT *
      FROM (
        SELECT
          e.id AS enrollment_id,
          e.roll_number,
          s.id AS student_id,
          s.first_name,
          s.last_name,
          ROUND(SUM(${PRESENT_SQL}) / NULLIF(COUNT(a.id), 0) * 100, 2) AS percentage,
          COUNT(a.id) AS total_days
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date BETWEEN :fromDate AND :toDate
        WHERE e.session_id = :sessionId
          AND e.class_id = :classId
          AND e.section_id = :sectionId
          AND e.status = 'active'
        GROUP BY e.id, e.roll_number, s.id, s.first_name, s.last_name
      ) x
      WHERE x.percentage < :threshold
      ORDER BY x.percentage ASC NULLS LAST, x.roll_number;
    `, {
      replacements: {
        fromDate: from,
        toDate: to,
        threshold: Number(threshold),
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
      },
    });

    res.ok({ students: rows, threshold: Number(threshold) }, `${rows.length} student(s) below threshold.`);
  } catch (err) { next(err); }
};

exports.attendanceChronicAbsentees = async (req, res, next) => {
  try {
    const { class_id, section_id, from = TODAY(), to = TODAY() } = req.query;
    requireFields(req.query, ['class_id', 'section_id']);

    const { session, scope } = await getTeacherContext(req);
    assertAccess(scope, Number(class_id), Number(section_id));

    const [rows] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.roll_number,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        sp.father_phone,
        sp.mother_phone,
        a.date
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      JOIN attendance a ON a.enrollment_id = e.id
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
        AND a.status = 'absent'
        AND a.date BETWEEN :fromDate AND :toDate
      ORDER BY e.id, a.date;
    `, {
      replacements: {
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
        fromDate: from,
        toDate: to,
      },
    });

    const chronic = [];
    const grouped = new Map();
    rows.forEach((row) => {
      if (!grouped.has(row.enrollment_id)) grouped.set(row.enrollment_id, []);
      grouped.get(row.enrollment_id).push(row);
    });

    grouped.forEach((items) => {
      let longest = 1;
      let current = 1;
      for (let i = 1; i < items.length; i += 1) {
        const prev = new Date(items[i - 1].date);
        const nextDate = new Date(items[i].date);
        const diff = Math.round((nextDate - prev) / 86400000);
        current = diff === 1 ? current + 1 : 1;
        longest = Math.max(longest, current);
      }
      if (longest >= 3) {
        chronic.push({
          ...items[0],
          consecutive_absent_days: longest,
          dates: items.map((item) => item.date),
        });
      }
    });

    res.ok({ students: chronic }, `${chronic.length} chronic absentee(s) found.`);
  } catch (err) { next(err); }
};

async function marksSubmissionLocked(teacherId, examId, classId, sectionId, subjectId) {
  const [[row]] = await sequelize.query(`
    SELECT id
    FROM exam_subjects
    WHERE exam_id = :examId
      AND subject_id = :subjectId
      AND review_status IN ('submitted', 'approved')
    LIMIT 1;
  `, { replacements: { examId, subjectId } });

  return !!row;
}

exports.marksExams = async (req, res, next) => {
  try {
    const { session, assignments } = await getTeacherContext(req);
    const subjectAssignments = assignments.filter((assignment) => assignment.subject_id);
    const classIds = uniqueNumbers(subjectAssignments.map((a) => a.class_id));
    
    if (classIds.length === 0) return res.ok({ exams: [] }, 'No assigned exams.');

    const [exams] = await sequelize.query(`
      SELECT 
        ex.id, 
        ex.class_id, 
        ex.name, 
        ex.exam_type, 
        ex.start_date, 
        ex.end_date, 
        ex.status, 
        c.name AS class_name,
        es.subject_id,
        es.review_status AS entry_status,
        s.name AS subject_name,
        s.code AS subject_code
      FROM exams ex
      JOIN classes c ON c.id = ex.class_id
      JOIN exam_subjects es ON es.exam_id = ex.id
      JOIN subjects s ON s.id = es.subject_id
      WHERE ex.session_id = :sessionId
        AND ex.class_id IN (:classIds)
      ORDER BY ex.start_date DESC, ex.id DESC;
    `, { replacements: { sessionId: session?.id || 0, classIds } });

    // Filter by teacher assignments
    const examSlots = [];
    exams.forEach(exam => {
      const isAssigned = subjectAssignments.some(a => 
        Number(a.class_id) === Number(exam.class_id) && 
        Number(a.subject_id) === Number(exam.subject_id)
      );

      if (isAssigned) {
        // Find sections for this class-subject assignment
        const sections = subjectAssignments.filter(a => 
          Number(a.class_id) === Number(exam.class_id) && 
          Number(a.subject_id) === Number(exam.subject_id)
        );

        sections.forEach(sec => {
          examSlots.push({
            ...exam,
            term_name: exam.exam_type.toUpperCase(),
            section_id: sec.section_id,
            section_name: sec.section_name,
            assignment_id: sec.id
          });
        });
      }
    });

    res.ok({ exams: examSlots }, `${examSlots.length} exam slot(s) available to this teacher.`);
  } catch (err) { next(err); }
};

exports.marksEntry = async (req, res, next) => {
  try {
    const { exam_id, class_id, section_id, subject_id } = req.query;
    requireFields(req.query, ['exam_id', 'class_id', 'section_id', 'subject_id']);

    const { session, scope } = await getTeacherContext(req);
    const access = assertMarksAccess(scope, Number(class_id), Number(section_id), Number(subject_id));

    const [[exam]] = await sequelize.query(`
      SELECT id, class_id, session_id, status
      FROM exams
      WHERE id = :examId
      LIMIT 1;
    `, { replacements: { examId: exam_id } });

    if (!exam) {
      return res.fail('Exam not found.', [], 404);
    }

    if (Number(exam.class_id) !== Number(class_id) || Number(exam.session_id) !== Number(session?.id || 0)) {
      return res.fail('Selected exam does not belong to this class or active session.', [], 422);
    }

    const [[examSubject]] = await sequelize.query(`
      SELECT
        es.subject_id,
        es.subject_type,
        es.theory_total_marks,
        es.theory_passing_marks,
        es.practical_total_marks,
        es.practical_passing_marks,
        es.combined_total_marks,
        es.combined_passing_marks,
        s.name AS subject_name,
        s.code AS subject_code
      FROM exam_subjects es
      JOIN subjects s ON s.id = es.subject_id
      WHERE es.exam_id = :examId
        AND es.subject_id = :subjectId
      LIMIT 1;
    `, {
      replacements: {
        examId: exam_id,
        subjectId: subject_id,
      },
    });

    if (!examSubject) {
      return res.fail('This subject is not configured for the selected exam.', [], 422);
    }

    const [rows] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.roll_number,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        er.id AS result_id,
        er.marks_obtained,
        er.theory_marks_obtained,
        er.practical_marks_obtained,
        er.is_absent,
        er.grade,
        er.is_pass
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN exam_results er
        ON er.exam_id = :examId
       AND er.enrollment_id = e.id
       AND er.subject_id = :subjectId
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
      ORDER BY COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer, e.roll_number;
    `, {
      replacements: {
        examId: exam_id,
        subjectId: subject_id,
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
      },
    });

    const locked = await marksSubmissionLocked(req.user.id, Number(exam_id), Number(class_id), Number(section_id), Number(subject_id));
    const reviewStatus = await getMarksReviewStatus(Number(exam_id), Number(subject_id));

    const enteredCount = rows.filter((row) => row.result_id).length;

    res.ok({
      access,
      locked,
      review_status: reviewStatus,
      max_marks: examSubject.combined_total_marks,
      students: rows.map((row) => ({
        ...row,
        marks: row.marks_obtained,
        subject_name: examSubject.subject_name,
        subject_code: examSubject.subject_code,
        subject_type: examSubject.subject_type,
        combined_total_marks: examSubject.combined_total_marks,
        combined_passing_marks: examSubject.combined_passing_marks,
        theory_total_marks: examSubject.theory_total_marks,
        theory_passing_marks: examSubject.theory_passing_marks,
        practical_total_marks: examSubject.practical_total_marks,
        practical_passing_marks: examSubject.practical_passing_marks,
      })),
      progress: {
        total_students: rows.length,
        entered_students: enteredCount,
        remaining_students: rows.length - enteredCount,
      },
    }, `${rows.length} student(s) found for marks entry.`);
  } catch (err) { next(err); }
};

async function saveOneMark(req, payload) {
  const {
    exam_id,
    enrollment_id,
    subject_id,
    marks_obtained = null,
    theory_marks_obtained = null,
    practical_marks_obtained = null,
    is_absent = false,
    reason = null,
    class_id,
    section_id,
  } = payload;
  const { scope } = await getTeacherContext(req);
  assertMarksAccess(scope, Number(class_id), Number(section_id), Number(subject_id));

  const [[exam]] = await sequelize.query(`
    SELECT id, class_id, session_id, status
    FROM exams
    WHERE id = :examId
    LIMIT 1;
  `, { replacements: { examId: exam_id } });

  if (!exam) {
    const error = new Error('Exam not found.');
    error.status = 404;
    throw error;
  }

  if (exam.status === 'completed') {
    const error = new Error('Exam is already completed. Marks can no longer be edited.');
    error.status = 409;
    throw error;
  }

  if (Number(exam.class_id) !== Number(class_id)) {
    const error = new Error('Selected exam does not belong to this class.');
    error.status = 422;
    throw error;
  }

  const [[enrollment]] = await sequelize.query(`
    SELECT id, class_id, section_id, session_id
    FROM enrollments
    WHERE id = :enrollmentId
    LIMIT 1;
  `, { replacements: { enrollmentId: enrollment_id } });

  if (!enrollment) {
    const error = new Error('Enrollment not found.');
    error.status = 404;
    throw error;
  }

  if (
    Number(enrollment.class_id) !== Number(class_id) ||
    Number(enrollment.section_id) !== Number(section_id) ||
    Number(enrollment.session_id) !== Number(exam.session_id)
  ) {
    const error = new Error('Enrollment does not belong to the selected exam class/section/session.');
    error.status = 422;
    throw error;
  }

  if (await marksSubmissionLocked(req.user.id, Number(exam_id), Number(class_id), Number(section_id), Number(subject_id))) {
    const error = new Error('Marks are already submitted for review and locked.');
    error.status = 409;
    throw error;
  }

  const [[subject]] = await sequelize.query(`
    SELECT
      es.subject_id AS id,
      s.class_id AS class_id,
      es.subject_type,
      es.combined_total_marks,
      es.combined_passing_marks,
      es.theory_total_marks,
      es.theory_passing_marks,
      es.practical_total_marks,
      es.practical_passing_marks
    FROM exam_subjects es
    JOIN subjects s ON s.id = es.subject_id
    WHERE es.exam_id = :examId
      AND es.subject_id = :subjectId
    LIMIT 1;
  `, { replacements: { examId: exam_id, subjectId: subject_id } });

  if (!subject) {
    const error = new Error('Subject not found.');
    error.status = 404;
    throw error;
  }

  if (Number(subject.class_id) !== Number(class_id) || Number(exam.class_id) !== Number(class_id)) {
    const error = new Error('Selected exam or subject does not belong to this class.');
    error.status = 422;
    throw error;
  }

  const normalizedTheory = theory_marks_obtained !== null && theory_marks_obtained !== '' ? Number(theory_marks_obtained) : null;
  const normalizedPractical = practical_marks_obtained !== null && practical_marks_obtained !== '' ? Number(practical_marks_obtained) : null;
  const normalizedCombined = marks_obtained !== null && marks_obtained !== '' ? Number(marks_obtained) : null;

  if (!is_absent) {
    if (subject.subject_type === 'theory' && normalizedCombined != null && normalizedCombined > Number(subject.combined_total_marks)) {
      const error = new Error(`Marks cannot exceed ${subject.combined_total_marks}.`);
      error.status = 422;
      throw error;
    }

    if (subject.subject_type === 'practical' && normalizedCombined != null && normalizedCombined > Number(subject.combined_total_marks)) {
      const error = new Error(`Marks cannot exceed ${subject.combined_total_marks}.`);
      error.status = 422;
      throw error;
    }

    if (subject.subject_type === 'both') {
      if (normalizedTheory != null && normalizedTheory > Number(subject.theory_total_marks || 0)) {
        const error = new Error(`Theory marks cannot exceed ${subject.theory_total_marks}.`);
        error.status = 422;
        throw error;
      }
      if (normalizedPractical != null && normalizedPractical > Number(subject.practical_total_marks || 0)) {
        const error = new Error(`Practical marks cannot exceed ${subject.practical_total_marks}.`);
        error.status = 422;
        throw error;
      }
    }
  }

  let marks = null;
  let theoryMarks = null;
  let practicalMarks = null;

  if (!is_absent) {
    if (subject.subject_type === 'theory') {
      marks = normalizedCombined;
      theoryMarks = normalizedCombined;
    } else if (subject.subject_type === 'practical') {
      marks = normalizedCombined;
      practicalMarks = normalizedCombined;
    } else {
      theoryMarks = normalizedTheory;
      practicalMarks = normalizedPractical;
      marks = theoryMarks != null || practicalMarks != null
        ? Number((Number(theoryMarks || 0) + Number(practicalMarks || 0)).toFixed(2))
        : null;
    }
  }

  const grade = is_absent
    ? 'AB'
    : marks == null
      ? null
      : marks >= Number(subject.combined_passing_marks)
        ? 'P'
        : 'F';
  const isPass = is_absent ? false : (marks != null ? marks >= Number(subject.combined_passing_marks) : null);

  await sequelize.query(`
    INSERT INTO exam_results (
      exam_id, enrollment_id, subject_id, marks_obtained, theory_marks_obtained, practical_marks_obtained,
      is_absent, grade, is_pass, entered_by, override_reason, created_at, updated_at
    )
    VALUES (
      :examId, :enrollmentId, :subjectId, :marks, :theoryMarks, :practicalMarks,
      :isAbsent, :grade, :isPass, :enteredBy, :reason, NOW(), NOW()
    )
    ON CONFLICT (exam_id, enrollment_id, subject_id)
    DO UPDATE SET
      marks_obtained = EXCLUDED.marks_obtained,
      theory_marks_obtained = EXCLUDED.theory_marks_obtained,
      practical_marks_obtained = EXCLUDED.practical_marks_obtained,
      is_absent = EXCLUDED.is_absent,
      grade = EXCLUDED.grade,
      is_pass = EXCLUDED.is_pass,
      entered_by = EXCLUDED.entered_by,
      override_reason = EXCLUDED.override_reason,
      updated_at = NOW();
  `, {
    replacements: {
      examId: exam_id,
      enrollmentId: enrollment_id,
      subjectId: subject_id,
      marks,
      theoryMarks,
      practicalMarks,
      isAbsent: !!is_absent,
      grade,
      isPass,
      enteredBy: req.user.id,
      reason,
    },
  });

  await audit('exam_results', Number(exam_id), {
    field: `${enrollment_id}:${subject_id}`,
    oldValue: null,
    newValue: is_absent ? 'ABSENT' : marks,
    reason: reason || 'Teacher marks save',
  }, req);

  await syncExamStatus(Number(exam_id));

  return {
    exam_id: Number(exam_id),
    enrollment_id: Number(enrollment_id),
    subject_id: Number(subject_id),
    marks_obtained: marks,
    theory_marks_obtained: theoryMarks,
    practical_marks_obtained: practicalMarks,
    is_absent: !!is_absent,
    grade,
    is_pass: isPass,
  };
}

exports.saveMark = async (req, res, next) => {
  try {
    const data = await saveOneMark(req, req.body);
    res.ok(data, 'Marks saved successfully.');
  } catch (err) { next(err); }
};

exports.bulkSaveMarks = async (req, res, next) => {
  try {
    const { entries = [] } = req.body;
    const saved = [];
    for (const entry of entries) {
      saved.push(await saveOneMark(req, entry));
    }
    res.ok({ saved }, `${saved.length} mark row(s) saved.`);
  } catch (err) { next(err); }
};

exports.submitMarks = async (req, res, next) => {
  try {
    const { exam_id, class_id, section_id, subject_id } = req.body;
    requireFields(req.body, ['exam_id', 'class_id', 'section_id', 'subject_id']);

    const { session, scope } = await getTeacherContext(req);
    assertMarksAccess(scope, Number(class_id), Number(section_id), Number(subject_id));

    const [[missing]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt
      FROM enrollments e
      LEFT JOIN exam_results er
        ON er.exam_id = :examId
       AND er.enrollment_id = e.id
       AND er.subject_id = :subjectId
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
        AND er.id IS NULL;
    `, {
      replacements: {
        examId: exam_id,
        subjectId: subject_id,
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
      },
    });

    if (Number(missing?.cnt || 0) > 0) {
      return res.fail('Cannot submit marks while entries are still missing.', [], 422);
    }

    await sequelize.query(`
      UPDATE exam_subjects
      SET review_status = 'submitted',
          submitted_by = :userId,
          submitted_at = NOW(),
          updated_by = :userId,
          updated_at = NOW()
      WHERE exam_id = :examId
        AND subject_id = :subjectId;
    `, {
      replacements: {
        examId: exam_id,
        subjectId: subject_id,
        userId: req.user.id,
      },
    });

    const examStatus = await syncExamStatus(Number(exam_id));
    const reviewStatus = await getMarksReviewStatus(Number(exam_id), Number(subject_id));

    res.ok({
      exam_id: Number(exam_id),
      subject_id: Number(subject_id),
      locked: true,
      exam_status: examStatus,
      review_status: reviewStatus,
    }, 'Marks submitted for review.');
  } catch (err) { next(err); }
};

exports.marksSummary = async (req, res, next) => {
  try {
    const { exam_id, class_id, section_id, subject_id } = req.query;
    requireFields(req.query, ['exam_id', 'class_id', 'section_id', 'subject_id']);

    const { session, scope } = await getTeacherContext(req);
    assertMarksAccess(scope, Number(class_id), Number(section_id), Number(subject_id));

    const [rows] = await sequelize.query(`
      SELECT
        e.roll_number,
        s.first_name,
        s.last_name,
        er.marks_obtained,
        er.theory_marks_obtained,
        er.practical_marks_obtained,
        er.grade,
        er.is_pass,
        er.is_absent,
        sub.name AS subject_name,
        sub.code AS subject_code,
        es.subject_type,
        es.combined_total_marks,
        es.combined_passing_marks
      FROM exam_results er
      JOIN enrollments e ON e.id = er.enrollment_id
      JOIN students s ON s.id = e.student_id
      JOIN subjects sub ON sub.id = er.subject_id
      JOIN exam_subjects es
        ON es.exam_id = er.exam_id
       AND es.subject_id = er.subject_id
      WHERE er.exam_id = :examId
        AND er.subject_id = :subjectId
        AND e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
      ORDER BY er.marks_obtained DESC NULLS LAST, e.roll_number;
    `, {
      replacements: {
        examId: exam_id,
        subjectId: subject_id,
        sessionId: session?.id || 0,
        classId: class_id,
        sectionId: section_id,
      },
    });

    const marks = rows.filter((row) => row.marks_obtained != null).map((row) => Number(row.marks_obtained));
    const summary = {
      highest: marks.length ? Math.max(...marks) : null,
      lowest: marks.length ? Math.min(...marks) : null,
      average: marks.length ? Number((marks.reduce((sum, value) => sum + value, 0) / marks.length).toFixed(2)) : null,
      pass_count: rows.filter((row) => row.is_pass === true).length,
      fail_count: rows.filter((row) => row.is_pass === false && row.is_absent === false).length,
      absent_count: rows.filter((row) => row.is_absent === true).length,
    };

    const topStudent = rows.find((row) => row.marks_obtained != null) || null;
    const bottomStudent = [...rows].reverse().find((row) => row.marks_obtained != null) || null;
    const reviewStatus = await getMarksReviewStatus(Number(exam_id), Number(subject_id));

    res.ok({
      review_status: reviewStatus,
      summary: {
        ...summary,
        highest_student: topStudent ? `${topStudent.first_name} ${topStudent.last_name}` : null,
        lowest_student: bottomStudent ? `${bottomStudent.first_name} ${bottomStudent.last_name}` : null,
      },
      students: rows,
    }, 'Marks summary generated.');
  } catch (err) { next(err); }
};

exports.studentList = async (req, res, next) => {
  try {
    const { session, assignments, scope } = await getTeacherContext(req);
    if (scope.sectionIds.length === 0) return res.ok({ students: [] }, 'No accessible students.');

    const { class_id, section_id, subject_id } = req.query;

    const [rows] = await sequelize.query(`
      SELECT
        s.id,
        s.admission_no,
        s.first_name,
        s.last_name,
        s.gender,
        e.id AS enrollment_id,
        e.roll_number,
        e.class_id,
        e.section_id,
        c.name AS class_name,
        sec.name AS section_name,
        sp.photo_path,
        ROUND(SUM(${PRESENT_SQL}) / NULLIF(COUNT(a.id), 0) * 100, 2) AS attendance_percentage,
        latest_result.percentage AS last_result_percentage,
        CASE
          WHEN ROUND(SUM(${PRESENT_SQL}) / NULLIF(COUNT(a.id), 0) * 100, 2) < 75 THEN 'warning'
          ELSE 'good'
        END AS attendance_status,
        (
          SELECT SUM((fi.amount_due + fi.late_fee_amount - fi.concession_amount) - fi.amount_paid)
          FROM fee_invoices fi
          WHERE fi.enrollment_id = e.id
            AND fi.status IN ('pending', 'partial')
        ) AS fee_balance,
        (
          SELECT STRING_AGG(ss.subject_id::text, ',')
          FROM student_subjects ss
          WHERE ss.student_id = s.id
            AND ss.session_id = e.session_id
            AND ss.is_active = true
        ) AS subject_ids
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN attendance a ON a.enrollment_id = e.id
      LEFT JOIN LATERAL (
        SELECT sr.percentage
        FROM student_results sr
        WHERE sr.enrollment_id = e.id
        ORDER BY sr.created_at DESC, sr.id DESC
        LIMIT 1
      ) latest_result ON true
      WHERE e.session_id = :sessionId
        AND e.status = 'active'
        AND s.is_deleted = false
        AND e.section_id IN (:sectionIds)
        AND (:classId::int IS NULL OR e.class_id = :classId)
        AND (:sectionId::int IS NULL OR e.section_id = :sectionId)
        AND (:subjectId::int IS NULL OR EXISTS (
          SELECT 1 FROM student_subjects ss2
          WHERE ss2.student_id = s.id
            AND ss2.session_id = e.session_id
            AND ss2.subject_id = :subjectId
            AND ss2.is_active = true
        ))
      GROUP BY s.id, s.admission_no, s.first_name, s.last_name, s.gender, e.id, e.roll_number, e.class_id, e.section_id, c.name, sec.name, sp.photo_path, latest_result.percentage
      ORDER BY c.name, sec.name, COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer;
    `, {
      replacements: {
        sessionId: session?.id || 0,
        sectionIds: scope.sectionIds.length ? scope.sectionIds : [-1],
        classId: class_id || null,
        sectionId: section_id || null,
        subjectId: subject_id || null,
      },
    });

    const classTeacherSections = scope.classTeacherSections;
    const subjectsMap = new Map();
    assignments.forEach((a) => {
      if (a.subject_id) {
        subjectsMap.set(a.subject_id, {
          value: a.subject_id,
          label: a.subject_name,
          class_id: a.class_id,
          section_id: a.section_id,
        });
      }
    });

    const formattedStudents = await Promise.all(rows.map(async (row) => {
      let is_online = false;
      if (redis.status === 'ready') {
        const key = `online:${req.user.school_id}:student:${row.id}`;
        const val = await redis.get(key);
        is_online = val === '1';
      }
      return {
        ...row,
        is_online,
        fee_balance: classTeacherSections.has(`${row.class_id}:${row.section_id}`) ? row.fee_balance : null,
      };
    }));

    res.ok({
      students: formattedStudents,
      available_subjects: [...subjectsMap.values()],
    }, `${formattedStudents.length} student(s) loaded.`);
  } catch (err) { next(err); }
};

exports.studentDetail = async (req, res, next) => {
  try {
    const { scope } = await getTeacherContext(req);
    const { student, access } = await getAccessibleStudent(scope, req.user.school_id, Number(req.params.id));

    const [[profile]] = await sequelize.query(`
      SELECT
        sp.address, sp.city, sp.state, sp.pincode, sp.phone, sp.email,
        sp.father_name, sp.father_phone, sp.mother_name, sp.mother_phone,
        sp.emergency_contact, sp.blood_group, sp.medical_notes, sp.photo_path
      FROM student_profiles sp
      WHERE sp.student_id = :studentId AND sp.is_current = true
      LIMIT 1;
    `, { replacements: { studentId: student.id } });

    let feeStatus = null;
    if (access.isClassTeacher) {
      const [[fee]] = await sequelize.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending', 'partial')) AS open_invoices,
          COALESCE(SUM((amount_due + late_fee_amount - concession_amount) - amount_paid), 0) AS balance
        FROM fee_invoices
        WHERE enrollment_id = :enrollmentId;
      `, { replacements: { enrollmentId: student.enrollment_id } });
      feeStatus = fee;
    }

    res.ok({
      ...student,
      profile: access.isClassTeacher ? profile : {
        phone: profile?.phone || null,
        father_phone: profile?.father_phone || null,
        mother_phone: profile?.mother_phone || null,
        photo_path: profile?.photo_path || null,
      },
      access,
      fee_status: feeStatus,
    }, 'Student detail loaded.');
  } catch (err) { next(err); }
};

exports.studentAttendance = async (req, res, next) => {
  try {
    const { scope } = await getTeacherContext(req);
    const { student } = await getAccessibleStudent(scope, req.user.school_id, Number(req.params.id));

    const [rows] = await sequelize.query(`
      SELECT id, date, status, override_reason
      FROM attendance
      WHERE enrollment_id = :enrollmentId
      ORDER BY date DESC;
    `, { replacements: { enrollmentId: student.enrollment_id } });

    res.ok({ attendance: rows }, `${rows.length} attendance row(s) found.`);
  } catch (err) { next(err); }
};

exports.studentResults = async (req, res, next) => {
  try {
    const { scope } = await getTeacherContext(req);
    const { student, access } = await getAccessibleStudent(scope, req.user.school_id, Number(req.params.id));

    const subjectRows = access.isClassTeacher
      ? []
      : await sequelize.query(`
          SELECT DISTINCT subject_id
          FROM teacher_assignments
          WHERE teacher_id = :teacherId
            AND class_id = :classId
            AND section_id = :sectionId
            AND is_active = true
            AND subject_id IS NOT NULL;
        `, {
          replacements: {
            teacherId: req.user.id,
            classId: student.class_id,
            sectionId: student.section_id,
          },
        }).then(([rows]) => rows);

    const subjectIds = access.isClassTeacher
      ? []
      : subjectRows.map((row) => Number(row.subject_id)).filter(Boolean);

    const subjectFilter = access.isClassTeacher
      ? ''
      : 'AND er.subject_id IN (:subjectIds)';
    const replacements = {
      enrollmentId: student.enrollment_id,
      subjectIds: subjectIds.length ? subjectIds : [-1],
    };

    const [rows] = await sequelize.query(`
      SELECT
        er.id,
        ex.name AS exam_name,
        sub.name AS subject_name,
        er.marks_obtained,
        er.grade,
        er.is_pass,
        er.is_absent,
        es.combined_total_marks AS max_marks
      FROM exam_results er
      JOIN exams ex ON ex.id = er.exam_id
      JOIN subjects sub ON sub.id = er.subject_id
      JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id
      WHERE er.enrollment_id = :enrollmentId
      ${subjectFilter}
      ORDER BY ex.start_date DESC, sub.name ASC;
    `, { replacements });

    res.ok({ results: rows, access }, `${rows.length} result row(s) found.`);
  } catch (err) { next(err); }
};

exports.studentRemarks = async (req, res, next) => {
  try {
    const { scope } = await getTeacherContext(req);
    const { student, access } = await getAccessibleStudent(scope, req.user.school_id, Number(req.params.id));

    const [rows] = await sequelize.query(`
      SELECT
        sr.id,
        sr.remark_type,
        sr.remark_text,
        CASE WHEN sr.visibility = 'share_parent' THEN 'share_student' ELSE sr.visibility END AS visibility,
        sr.is_edited,
        sr.edited_at,
        sr.created_at,
        CONCAT(u.first_name, ' ', u.last_name) AS teacher_name,
        sr.teacher_id
      FROM student_remarks sr
      JOIN teachers u ON u.id = sr.teacher_id
      WHERE sr.student_id = :studentId
        AND sr.is_deleted = false
        AND (${access.isClassTeacher ? 'true' : 'sr.teacher_id = :teacherId'})
      ORDER BY sr.created_at DESC;
    `, {
      replacements: {
        studentId: student.id,
        teacherId: req.user.id,
      },
    });

    res.ok({ remarks: rows, access }, `${rows.length} remark(s) found.`);
  } catch (err) { next(err); }
};

exports.remarksList = async (req, res, next) => {
  try {
    const { scope } = await getTeacherContext(req);
    if (scope.sectionIds.length === 0) return res.ok({ remarks: [] }, 'No accessible remarks.');

    const classTeacherPairs = [...scope.classTeacherSections]
      .map((key) => key.split(':').map(Number))
      .filter(([classId, sectionId]) => Number.isFinite(classId) && Number.isFinite(sectionId));

    const classTeacherCondition = classTeacherPairs.length
      ? classTeacherPairs
          .map(([classId, sectionId], index) => `(e.class_id = :ctClass${index} AND e.section_id = :ctSection${index})`)
          .join(' OR ')
      : null;

    const replacements = {
      sectionIds: scope.sectionIds.length ? scope.sectionIds : [-1],
      teacherId: req.user.id,
    };

    classTeacherPairs.forEach(([classId, sectionId], index) => {
      replacements[`ctClass${index}`] = classId;
      replacements[`ctSection${index}`] = sectionId;
    });

    const [rows] = await sequelize.query(`
      SELECT
        sr.id,
        sr.student_id,
        sr.teacher_id,
        sr.remark_type,
        sr.remark_text,
        CASE WHEN sr.visibility = 'share_parent' THEN 'share_student' ELSE sr.visibility END AS visibility,
        sr.is_edited,
        sr.created_at,
        s.first_name,
        s.last_name,
        e.roll_number,
        e.class_id,
        e.section_id,
        c.name AS class_name,
        sec.name AS section_name,
        CONCAT(u.first_name, ' ', u.last_name) AS teacher_name
      FROM student_remarks sr
      JOIN students s ON s.id = sr.student_id
      JOIN enrollments e ON e.id = sr.enrollment_id
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      JOIN teachers u ON u.id = sr.teacher_id
      WHERE sr.is_deleted = false
        AND e.section_id IN (:sectionIds)
        AND (${classTeacherCondition ? `(${classTeacherCondition}) OR sr.teacher_id = :teacherId` : 'sr.teacher_id = :teacherId'})
      ORDER BY sr.created_at DESC;
    `, { replacements });

    res.ok({ remarks: rows }, `${rows.length} remark(s) loaded.`);
  } catch (err) { next(err); }
};

exports.createRemark = async (req, res, next) => {
  try {
    const { student_id, remark_type, remark_text, visibility = 'private', date = TODAY() } = req.body;
    requireFields(req.body, ['student_id', 'remark_type', 'remark_text']);
    const normalizedVisibility = normalizeTeacherRemarkVisibility(visibility);

    const { scope } = await getTeacherContext(req);
    const { student } = await getAccessibleStudent(scope, req.user.school_id, Number(student_id));

    const [[remark]] = await sequelize.query(`
      INSERT INTO student_remarks (
        student_id, teacher_id, enrollment_id, remark_type, remark_text, visibility,
        is_edited, edited_at, is_deleted, created_at, updated_at
      )
      VALUES (
        :studentId, :teacherId, :enrollmentId, :remarkType, :remarkText, :visibility,
        false, NULL, false, :createdAt, NOW()
      )
      RETURNING id, student_id, teacher_id, enrollment_id, remark_type, remark_text, visibility, created_at;
    `, {
      replacements: {
        studentId: student.id,
        teacherId: req.user.id,
        enrollmentId: student.enrollment_id,
        remarkType: remark_type,
        remarkText: remark_text,
        visibility: normalizedVisibility,
        createdAt: new Date(`${date}T00:00:00Z`),
      },
    });

    await audit('student_remarks', remark.id, {
      field: 'created',
      oldValue: null,
      newValue: remark_type,
      reason: 'Teacher remark created',
    }, req);

    res.ok({ remark }, 'Remark created successfully.', 201);
  } catch (err) { next(err); }
};

exports.updateRemark = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { remark_text, visibility } = req.body;
    requireFields(req.body, ['remark_text']);
    const normalizedVisibility = visibility === undefined
      ? null
      : normalizeTeacherRemarkVisibility(visibility);

    const [[remark]] = await sequelize.query(`
      SELECT id, teacher_id, created_at, remark_text, visibility
      FROM student_remarks
      WHERE id = :id AND is_deleted = false;
    `, { replacements: { id } });

    if (!remark) return res.fail('Remark not found.', [], 404);
    if (Number(remark.teacher_id) !== Number(req.user.id)) return res.fail('You can only edit your own remarks.', [], 403);
    if ((Date.now() - new Date(remark.created_at).getTime()) > 24 * 60 * 60 * 1000) {
      return res.fail('Remarks can only be edited within 24 hours.', [], 403);
    }

    await sequelize.query(`
      UPDATE student_remarks
      SET remark_text = :remarkText,
          visibility = COALESCE(:visibility, visibility),
          is_edited = true,
          edited_at = NOW(),
          updated_at = NOW()
      WHERE id = :id;
    `, {
      replacements: {
        id,
        remarkText: remark_text,
        visibility: normalizedVisibility,
      },
    });

    await audit('student_remarks', Number(id), {
      field: 'remark_text',
      oldValue: remark.remark_text,
      newValue: remark_text,
      reason: 'Teacher remark updated',
    }, req);

    res.ok({ id: Number(id) }, 'Remark updated successfully.');
  } catch (err) { next(err); }
};

exports.studentRemarkTimeline = async (req, res, next) => {
  return exports.studentRemarks(req, res, next);
};

exports.timetable = async (req, res, next) => {
  try {
    const { session } = await getTeacherContext(req);
    const [rows] = await sequelize.query(`
      SELECT
        ts.id,
        ts.day_of_week,
        ts.period_number,
        ts.start_time,
        ts.end_time,
        ts.room_number,
        c.name AS class_name,
        sec.name AS section_name,
        sub.name AS subject_name,
        sub.code AS subject_code
      FROM timetable_slots ts
      JOIN classes c ON c.id = ts.class_id
      JOIN sections sec ON sec.id = ts.section_id
      JOIN subjects sub ON sub.id = ts.subject_id
      JOIN teacher_assignments ta
        ON ta.session_id = ts.session_id
       AND ta.class_id = ts.class_id
       AND ta.section_id = ts.section_id
       AND ta.teacher_id = ts.teacher_id
       AND ta.subject_id = ts.subject_id
       AND ta.is_active = true
      WHERE ts.teacher_id = :teacherId
        AND ts.session_id = :sessionId
        AND ts.is_active = true
      ORDER BY ts.day_of_week, ts.period_number;
    `, { replacements: { teacherId: req.user.id, sessionId: session?.id || 0 } });

    res.ok({ timetable: rows }, `${rows.length} timetable slot(s) found.`);
  } catch (err) { next(err); }
};

exports.timetableToday = async (req, res, next) => {
  return exports.todaySchedule(req, res, next);
};

exports.currentPeriod = async (req, res, next) => {
  try {
    const { session } = await getTeacherContext(req);
    const schedule = decorateScheduleRows(await getTodayScheduleRows(req.user.id, session?.id));
    const current = schedule.find((row) => row.status === 'current') || null;
    res.ok({ current_period: current }, current ? 'Current period found.' : 'No active period right now.');
  } catch (err) { next(err); }
};

exports.examTimetable = async (req, res, next) => {
  try {
    const { session, scope } = await getTeacherContext(req);
    const teacherId = req.user.id;
    const sessionId = session?.id || 0;

    const classTeacherPairs = [...scope.classTeacherSections];
    const hasClassTeacherRole = classTeacherPairs.length > 0;

    const tupleClause = hasClassTeacherRole
      ? classTeacherPairs.map((_, index) => `(:classId${index}, :sectionId${index})`).join(', ')
      : '(NULL, NULL)';

    const replacements = {
      sessionId,
      teacherId,
      ...Object.fromEntries(
        classTeacherPairs.flatMap((key, index) => {
          const [classId, sectionId] = key.split(':');
          return [[`classId${index}`, Number(classId)], [`sectionId${index}`, Number(sectionId)]];
        })
      ),
    };

    const [rows] = await sequelize.query(`
      SELECT
        ex.id AS exam_id,
        ex.name AS exam_name,
        ex.exam_type,
        ex.start_date AS exam_start_date,
        ex.end_date AS exam_end_date,
        ex.status AS exam_status,
        es.id AS exam_subject_id,
        es.exam_date,
        es.start_time,
        es.end_time,
        sub.name AS subject_name,
        sub.code AS subject_code,
        c.name AS class_name,
        sec.name AS section_name,
        CASE
          WHEN es.invigilator_teacher_id = :teacherId THEN 'invigilator'
          WHEN ta.id IS NOT NULL THEN 'subject_teacher'
          WHEN (ex.class_id, sec.id) IN (${tupleClause}) THEN 'class_teacher'
          ELSE 'none'
        END AS duty_type
      FROM exams ex
      JOIN exam_subjects es ON es.exam_id = ex.id
      JOIN subjects sub ON sub.id = es.subject_id
      JOIN classes c ON c.id = ex.class_id
      JOIN sections sec ON sec.class_id = ex.class_id
      LEFT JOIN teacher_assignments ta
        ON ta.session_id = ex.session_id
       AND ta.class_id = ex.class_id
       AND ta.section_id = sec.id
       AND ta.subject_id = es.subject_id
       AND ta.teacher_id = :teacherId
       AND ta.is_active = true
      WHERE (:sessionId::int IS NULL OR ex.session_id = :sessionId)
        AND ex.status IN ('draft', 'published', 'upcoming', 'ongoing', 'completed')
        AND (
          es.invigilator_teacher_id = :teacherId 
          OR ta.id IS NOT NULL
          OR (ex.class_id, sec.id) IN (${tupleClause})
        )
      ORDER BY es.exam_date ASC, es.start_time ASC;
    `, { replacements });

    res.ok({ timetable: rows }, `${rows.length} exam duty/assignment(s) found.`);
  } catch (err) { next(err); }
};
exports.homeworkList = async (req, res, next) => {
  try {
    const { scope } = await getTeacherContext(req);
    if (scope.sectionIds.length === 0) return res.ok({ homework: [] }, 'No homework found.');

    const [rows] = await sequelize.query(`
      SELECT
        h.*,
        c.name AS class_name,
        sec.name AS section_name,
        sub.name AS subject_name,
        COUNT(DISTINCT e.id) AS student_count,
        COUNT(hs.id) FILTER (WHERE hs.status IN ('submitted', 'graded')) AS submitted_count,
        COUNT(DISTINCT e.id) - COUNT(hs.id) FILTER (WHERE hs.status IN ('submitted', 'graded')) AS pending_count,
        COUNT(hs.id) FILTER (WHERE hs.status = 'graded') AS graded_count,
        COUNT(hs.id) FILTER (WHERE hs.is_late = true AND hs.status IN ('submitted', 'graded')) AS late_count
      FROM homework h
      JOIN classes c ON c.id = h.class_id
      JOIN sections sec ON sec.id = h.section_id
      JOIN subjects sub ON sub.id = h.subject_id
      JOIN enrollments e
        ON e.class_id = h.class_id
       AND e.section_id = h.section_id
       AND e.session_id = h.session_id
       AND e.status = 'active'
      LEFT JOIN homework_submissions hs
        ON hs.homework_id = h.id
       AND hs.enrollment_id = e.id
      WHERE h.teacher_id = :teacherId
      GROUP BY h.id, c.name, sec.name, sub.name
      ORDER BY h.created_at DESC;
    `, { replacements: { teacherId: req.user.id } });

    const homework = rows.map((row) => {
      const pendingCount = Number(row.pending_count || 0);
      const submittedCount = Number(row.submitted_count || 0);
      const studentCount = Number(row.student_count || 0);
      const isOverdue = String(row.due_date) < TODAY() && pendingCount > 0;
      const workflowStatus = row.status === 'cancelled'
        ? 'cancelled'
        : pendingCount === 0 || studentCount === submittedCount
          ? 'completed'
          : isOverdue
            ? 'overdue'
            : 'active';

      return {
        ...row,
        student_count: studentCount,
        submitted_count: submittedCount,
        pending_count: pendingCount,
        graded_count: Number(row.graded_count || 0),
        late_count: Number(row.late_count || 0),
        workflow_status: workflowStatus,
      };
    });

    res.ok({ homework }, `${homework.length} homework item(s) found.`);
  } catch (err) { next(err); }
};

exports.createHomework = async (req, res, next) => {
  try {
    const { class_id, section_id, subject_id, title, description, due_date, submission_type, max_marks = null } = req.body;
    let { attachment_path = null } = req.body;
    validateHomeworkPayload(req.body);

    if (req.file) {
      attachment_path = req.file.path.replace(/\\/g, '/');
    }

    const { session, scope } = await getTeacherContext(req);
    assertAccess(scope, Number(class_id), Number(section_id), Number(subject_id));

    const [[homework]] = await sequelize.query(`
      INSERT INTO homework (
        class_id, section_id, subject_id, teacher_id, session_id, title, description, due_date,
        submission_type, max_marks, attachment_path, status, created_at, updated_at
      )
      VALUES (
        :classId, :sectionId, :subjectId, :teacherId, :sessionId, :title, :description, :dueDate,
        :submissionType, :maxMarks, :attachmentPath, 'active', NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        classId: class_id,
        sectionId: section_id,
        subjectId: subject_id,
        teacherId: req.user.id,
        sessionId: session?.id || 0,
        title,
        description,
        dueDate: due_date,
        submissionType: submission_type,
        maxMarks: max_marks,
        attachmentPath: attachment_path,
      },
    });

    await ensureHomeworkPendingRows(homework.id, homework);

    await notifyClass(class_id, section_id, `New Assignment: ${title}`, `A new assignment has been posted for your class. Due: ${due_date}`, 'homework', { homework_id: homework.id });

    await audit('homework', homework.id, {
      field: 'created',
      oldValue: null,
      newValue: title,
      reason: 'Teacher homework created',
    }, req);

    res.ok({ homework }, 'Homework created successfully.', 201);
  } catch (err) { next(err); }
};

exports.updateHomework = async (req, res, next) => {
  try {
    const { id } = req.params;
    const homework = await getOwnedHomeworkForTeacher(id, req.user.id);
    if (!homework) return res.fail('Homework not found.', [], 404);

    if (req.file) {
      req.body.attachment_path = req.file.path.replace(/\\/g, '/');
    }

    const allowed = ['title', 'description', 'due_date', 'submission_type', 'max_marks', 'attachment_path', 'status'];
    const updates = Object.keys(req.body).filter((key) => allowed.includes(key));
    if (updates.length === 0) return res.fail('No valid fields to update.', [], 422);
    validateHomeworkPayload(req.body, { partial: true });

    const setClause = updates.map((key) => `${key} = :${key}`).join(', ');
    await sequelize.query(`
      UPDATE homework
      SET ${setClause}, updated_at = NOW()
      WHERE id = :id;
    `, { replacements: { ...req.body, id } });

    await audit('homework', Number(id), {
      field: 'updated',
      oldValue: homework.status,
      newValue: req.body.status || homework.status,
      reason: 'Teacher homework updated',
    }, req);

    res.ok({ id: Number(id) }, 'Homework updated successfully.');
  } catch (err) { next(err); }
};

exports.deleteHomework = async (req, res, next) => {
  try {
    const { id } = req.params;
    const homework = await getOwnedHomeworkForTeacher(id, req.user.id);
    if (!homework) return res.fail('Homework not found.', [], 404);

    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`
        DELETE FROM homework_submissions
        WHERE homework_id = :id;
      `, {
        replacements: { id },
        transaction,
      });

      await sequelize.query(`
        DELETE FROM homework
        WHERE id = :id AND teacher_id = :teacherId;
      `, {
        replacements: { id, teacherId: req.user.id },
        transaction,
      });
    });

    await audit('homework', Number(id), {
      field: 'deleted',
      oldValue: homework.title,
      newValue: null,
      reason: 'Teacher deleted homework',
    }, req);

    res.ok({ id: Number(id) }, 'Homework deleted successfully.');
  } catch (err) { next(err); }
};

exports.homeworkSubmissions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const homework = await getOwnedHomeworkForTeacher(id, req.user.id);
    if (!homework) return res.fail('Homework not found.', [], 404);

    await ensureHomeworkPendingRows(id, homework);

    const [rows] = await sequelize.query(`
      SELECT
        hs.id,
        hs.homework_id,
        hs.enrollment_id,
        hs.submitted_at,
        hs.submission_content,
        hs.attachment_path,
        hs.marks_obtained,
        hs.teacher_comment,
        hs.is_late,
        hs.status,
        hs.created_at,
        e.roll_number,
        e.class_id,
        e.section_id,
        s.first_name,
        s.last_name,
        s.admission_no
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN homework_submissions hs
        ON hs.enrollment_id = e.id
       AND hs.homework_id = :id
      WHERE e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.session_id = :sessionId
        AND e.status = 'active'
      ORDER BY e.roll_number ASC, s.first_name ASC, s.last_name ASC;
    `, {
      replacements: {
        id,
        classId: homework.class_id,
        sectionId: homework.section_id,
        sessionId: homework.session_id,
      },
    });

    const submissions = rows.map((row) => ({
      ...row,
      id: row.id || null,
      status: row.status || 'pending',
      is_late: Boolean(row.is_late),
    }));

    const summary = submissions.reduce((acc, row) => {
      acc.total += 1;
      if (row.status === 'pending') acc.pending += 1;
      if (row.status === 'submitted') acc.submitted += 1;
      if (row.status === 'graded') acc.graded += 1;
      if (row.is_late) acc.late += 1;
      return acc;
    }, { total: 0, pending: 0, submitted: 0, graded: 0, late: 0 });

    res.ok({ homework, submissions, summary }, `${submissions.length} homework submission(s) found.`);
  } catch (err) { next(err); }
};

exports.gradeHomework = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { submission_id, marks_obtained, teacher_comment = null } = req.body;
    requireFields(req.body, ['submission_id']);

    const homework = await getOwnedHomeworkForTeacher(id, req.user.id);
    if (!homework) return res.fail('Homework not found.', [], 404);
    if (marks_obtained != null && Number(marks_obtained) < 0) {
      return res.fail('marks_obtained cannot be negative.', [], 422);
    }
    if (homework.max_marks != null && marks_obtained != null && Number(marks_obtained) > Number(homework.max_marks)) {
      return res.fail('marks_obtained cannot exceed homework max marks.', [], 422);
    }

    await sequelize.query(`
      UPDATE homework_submissions
      SET marks_obtained = :marks,
          teacher_comment = :comment,
          status = 'graded'
      WHERE id = :submissionId AND homework_id = :homeworkId;
    `, {
      replacements: {
        submissionId: submission_id,
        homeworkId: id,
        marks: marks_obtained,
        comment: teacher_comment,
      },
    });

    await audit('homework_submissions', Number(submission_id), {
      field: 'graded',
      oldValue: null,
      newValue: marks_obtained,
      reason: 'Homework graded by teacher',
    }, req);

    res.ok({ submission_id: Number(submission_id) }, 'Homework graded successfully.');
  } catch (err) { next(err); }
};

exports.submitHomeworkForStudent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { submission_id, teacher_note = null } = req.body;
    requireFields(req.body, ['submission_id']);

    const homework = await getOwnedHomeworkForTeacher(id, req.user.id);
    if (!homework) return res.fail('Homework not found.', [], 404);
    if (homework.submission_type !== 'written') {
      return res.fail('Teacher submission is only available for physical homework.', [], 422);
    }

    const [[submission]] = await sequelize.query(`
      SELECT id, status, homework_id
      FROM homework_submissions
      WHERE id = :submissionId
        AND homework_id = :homeworkId
      LIMIT 1;
    `, {
      replacements: {
        submissionId: submission_id,
        homeworkId: id,
      },
    });

    if (!submission) return res.fail('Submission record not found.', [], 404);

    await sequelize.query(`
      UPDATE homework_submissions
      SET submitted_at = NOW(),
          submission_content = COALESCE(NULLIF(:teacherNote, ''), submission_content, 'Submitted physically to the teacher.'),
          is_late = CASE WHEN :dueDate < :today THEN true ELSE false END,
          status = CASE WHEN status = 'graded' THEN status ELSE 'submitted' END
      WHERE id = :submissionId
        AND homework_id = :homeworkId;
    `, {
      replacements: {
        submissionId: submission_id,
        homeworkId: id,
        teacherNote: teacher_note,
        dueDate: String(homework.due_date),
        today: TODAY(),
      },
    });

    await audit('homework_submissions', Number(submission_id), {
      field: 'submitted',
      oldValue: submission.status,
      newValue: 'submitted',
      reason: 'Teacher marked physical homework as submitted',
    }, req);

    res.ok({ submission_id: Number(submission_id) }, 'Homework marked as submitted.');
  } catch (err) { next(err); }
};

exports.remindHomework = async (req, res, next) => {
  try {
    const { id } = req.params;
    const homework = await getOwnedHomeworkForTeacher(id, req.user.id);
    if (!homework) return res.fail('Homework not found.', [], 404);

    await ensureHomeworkPendingRows(id, homework);

    const [[summary]] = await sequelize.query(`
      SELECT
        COUNT(*) AS total_students,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_students
      FROM homework_submissions
      WHERE homework_id = :id;
    `, { replacements: { id } });

    await audit('homework', Number(id), {
      field: 'reminder',
      oldValue: null,
      newValue: 'pending students reminded',
      reason: 'Homework reminder sent',
    }, req);
    res.ok({
      homework_id: Number(id),
      total_students: Number(summary?.total_students || 0),
      pending_students: Number(summary?.pending_students || 0),
    }, 'Homework reminder logged.');
  } catch (err) { next(err); }
};

exports.noticeList = async (req, res, next) => {
  try {
    const { scope } = await getTeacherContext(req);
    const category = req.query.category || null;
    const mineOnly = String(req.query.mine || '').toLowerCase() === 'true';
    const classTeacherPairs = [...scope.classTeacherSections];

    const [rows] = await sequelize.query(`
      SELECT
        n.*,
        COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), admin.name) AS teacher_name,
        COALESCE(n.created_by_role, 'teacher') AS teacher_role,
        c.name AS class_name,
        sec.name AS section_name,
        COUNT(nr.id) AS read_count,
        MAX(CASE WHEN nr.user_id = :teacherId THEN 1 ELSE 0 END) = 1 AS is_read
      FROM teacher_notices n
      LEFT JOIN teachers u ON u.id = n.teacher_id
      LEFT JOIN users admin ON admin.id = n.created_by_user_id
      LEFT JOIN classes c ON c.id = n.class_id
      LEFT JOIN sections sec ON sec.id = n.section_id
      LEFT JOIN teacher_notice_reads nr ON nr.notice_id = n.id
      WHERE n.is_active = true
        AND (u.school_id = :schoolId OR admin.school_id = :schoolId)
        AND (n.expiry_date IS NULL OR n.expiry_date >= NOW())
        AND (:category::text IS NULL OR n.category = :category)
        AND (:mineOnly = false OR n.teacher_id = :teacherId)
        AND (
          n.target_scope = 'teachers'
          OR n.target_scope = 'whole_school'
          OR (n.target_scope = 'specific_teacher' AND n.target_teacher_id = :teacherId)
          OR (n.target_scope IN ('my_class_only', 'whole_class') AND (n.class_id, n.section_id) IN (${classTeacherPairs.map((_, i) => `(:classId${i}, :sectionId${i})`).join(', ') || '(NULL, NULL)'}))
          OR (n.target_scope = 'specific_section' AND n.section_id IN (:sectionIds))
          OR n.teacher_id = :teacherId
        )      GROUP BY n.id, u.id, u.first_name, u.last_name, admin.id, admin.name, c.id, sec.id
      ORDER BY n.publish_date DESC;
    `, {
      replacements: {
        teacherId: req.user.id,
        schoolId: req.user.school_id,
        category,
        mineOnly,
        sectionIds: scope.sectionIds.length ? scope.sectionIds : [-1],
        ...Object.fromEntries(
          classTeacherPairs.flatMap((key, index) => {
            const [classId, sectionId] = key.split(':');
            return [[`classId${index}`, Number(classId)], [`sectionId${index}`, Number(sectionId)]];
          })
        ),
      },
    });

    res.ok({ notices: rows }, `${rows.length} notice(s) found.`);
  } catch (err) { next(err); }
};

exports.createNotice = async (req, res, next) => {
  try {
    const {
      title,
      content,
      category = 'general',
      target_scope,
      class_id = null,
      section_id = null,
      subject_id = null,
      target_student_id = null,
      attachment_path = null,
      publish_date = new Date(),
      expiry_date = null,
    } = req.body;
    validateNoticePayload({ ...req.body, category, publish_date, expiry_date });

    const { scope } = await getTeacherContext(req);
    if (target_scope === 'my_class_only' || target_scope === 'whole_class') {
      requireFields({ class_id, section_id }, ['class_id', 'section_id']);
      if (!scope.classTeacherSections.has(`${class_id}:${section_id}`)) {
        return res.fail('You can only post to your own class teacher section.', [], 403);
      }
    }
    if (target_scope === 'specific_section') {
      requireFields({ class_id, section_id }, ['class_id', 'section_id']);
      assertAccess(scope, Number(class_id), Number(section_id));
    }
    if (target_scope === 'specific_subject') {
      requireFields({ class_id, section_id, subject_id }, ['class_id', 'section_id', 'subject_id']);
      const isAssigned = scope.assignments.some(a => 
        Number(a.class_id) === Number(class_id) && 
        Number(a.section_id) === Number(section_id) && 
        Number(a.subject_id) === Number(subject_id)
      );
      if (!isAssigned) {
        return res.fail('You can only post to subjects you are assigned to.', [], 403);
      }
    }
    if (target_scope === 'specific_student') {
      requireFields({ target_student_id }, ['target_student_id']);
      await getAccessibleStudent(scope, req.user.school_id, Number(target_student_id));
    }

    const [[notice]] = await sequelize.query(`
      INSERT INTO teacher_notices (
        teacher_id, created_by_role, class_id, section_id, subject_id, target_student_id, title, content, category, target_scope,
        attachment_path, publish_date, expiry_date, is_active, created_at, updated_at
      )
      VALUES (
        :teacherId, 'teacher', :classId, :sectionId, :subjectId, :targetStudentId, :title, :content, :category, :targetScope,
        :attachmentPath, :publishDate, :expiryDate, true, NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        teacherId: req.user.id,
        classId: class_id,
        sectionId: section_id,
        subjectId: subject_id,
        targetStudentId: target_student_id,
        title,
        content,
        category,
        targetScope: target_scope,
        attachmentPath: attachment_path,
        publishDate: publish_date,
        expiryDate: expiry_date,
      },
    });

    const { notifyClass, notifyAllStudents, sendNotification, notifySubject } = require('../utils/notification');

    if (target_scope === 'my_class_only' || target_scope === 'specific_section' || target_scope === 'whole_class') {
      await notifyClass(class_id, section_id, title, content, 'notice', { notice_id: notice.id });
    } else if (target_scope === 'specific_subject') {
      await notifySubject(subject_id, title, content, 'notice', { notice_id: notice.id });
    } else if (target_scope === 'specific_student') {
      await sendNotification({ studentId: target_student_id, title, content, type: 'notice', data: { notice_id: notice.id } });
    } else if (target_scope === 'all_students') {
       await notifyAllStudents(req.user.school_id, title, content, 'notice', { notice_id: notice.id });
    }

    await audit('teacher_notices', notice.id, {
      field: 'created',
      oldValue: null,
      newValue: title,
      reason: 'Teacher notice posted',
    }, req);

    res.ok({ notice }, 'Notice posted successfully.', 201);
  } catch (err) { next(err); }
};

exports.updateNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[notice]] = await sequelize.query(`
      SELECT id, teacher_id, created_at, title, publish_date, expiry_date
      FROM teacher_notices
      WHERE id = :id AND is_active = true;
    `, { replacements: { id } });

    if (!notice) return res.fail('Notice not found.', [], 404);
    if (Number(notice.teacher_id) !== Number(req.user.id)) return res.fail('You can only edit your own notices.', [], 403);
    if ((Date.now() - new Date(notice.created_at).getTime()) > 24 * 60 * 60 * 1000) {
      return res.fail('Notices can only be edited within 24 hours.', [], 403);
    }

    const updates = ['title', 'content', 'category', 'attachment_path', 'expiry_date']
      .filter((key) => req.body[key] !== undefined);
    if (updates.length === 0) return res.fail('No valid fields to update.', [], 422);
    validateNoticePayload({ ...req.body, publish_date: notice.publish_date }, { partial: true });

    const setClause = updates.map((key) => `${key} = :${key}`).join(', ');
    await sequelize.query(`
      UPDATE teacher_notices
      SET ${setClause}, updated_at = NOW()
      WHERE id = :id;
    `, { replacements: { ...req.body, id } });

    await audit('teacher_notices', Number(id), {
      field: 'updated',
      oldValue: notice.title,
      newValue: req.body.title || notice.title,
      reason: 'Teacher notice updated',
    }, req);

    res.ok({ id: Number(id) }, 'Notice updated successfully.');
  } catch (err) { next(err); }
};

exports.readNotice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scope } = await getTeacherContext(req);
    const notice = await getAccessibleNoticeForTeacher(id, req, scope);
    if (!notice) return res.fail('Notice not found.', [], 404);

    await sequelize.query(`
      INSERT INTO teacher_notice_reads (notice_id, user_id, read_at)
      VALUES (:noticeId, :userId, NOW())
      ON CONFLICT (notice_id, user_id)
      DO UPDATE SET read_at = NOW();
    `, { replacements: { noticeId: id, userId: req.user.id } });

    res.ok({ notice_id: Number(id) }, 'Notice marked as read.');
  } catch (err) { next(err); }
};

exports.leaveBalance = async (req, res, next) => {
  try {
    const { session } = await getTeacherContext(req);
    if (!session) {
      return res.fail('No active session found. Configure the current session before using leave applications.', [], 422);
    }

    await ensureTeacherLeaveBalances(req.user.id, session.id);

    const calendar = await getSessionCalendar(session?.id || 0);
    const [rows] = await sequelize.query(`
      SELECT leave_type, total_allowed, used, remaining
      FROM leave_balances
      WHERE teacher_id = :teacherId AND session_id = :sessionId
      ORDER BY leave_type;
    `, { replacements: { teacherId: req.user.id, sessionId: session?.id || 0 } });

    res.ok({
      balances: rows,
      session,
      working_days: calendar.workingDays,
      holidays: calendar.holidays,
    }, `${rows.length} leave balance row(s) found.`);
  } catch (err) { next(err); }
};

exports.leaveApplications = async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT tl.*, reviewer.name AS reviewed_by_name
      FROM teacher_leaves tl
      LEFT JOIN users reviewer ON reviewer.id = tl.reviewed_by
      WHERE tl.teacher_id = :teacherId
      ORDER BY tl.created_at DESC;
    `, { replacements: { teacherId: req.user.id } });

    res.ok({ applications: rows }, `${rows.length} leave application(s) found.`);
  } catch (err) { next(err); }
};

exports.applyLeave = async (req, res, next) => {
  try {
    const { session } = await getTeacherContext(req);
    if (!session) {
      return res.fail('No active session found. Configure the current session before submitting leave applications.', [], 422);
    }

    const { leave_type, from_date, to_date, reason, document_path = null } = req.body;
    requireFields(req.body, ['leave_type', 'from_date', 'to_date', 'reason']);

    const allowedTypes = new Set(['casual', 'sick', 'emergency', 'earned', 'without_pay']);
    if (!allowedTypes.has(leave_type)) {
      return res.fail('Invalid leave_type.', [], 422);
    }
    if (to_date < from_date) {
      return res.fail('to_date cannot be earlier than from_date.', [], 422);
    }

    const calendar = await getSessionCalendar(session?.id || 0);
    const computed = computeLeaveDays(from_date, to_date, calendar.workingDays, calendar.holidays);
    if (computed.daysCount <= 0) {
      return res.fail('Selected date range does not include any working day.', [], 422);
    }

    await ensureTeacherLeaveBalances(req.user.id, session.id);

    const [[overlap]] = await sequelize.query(`
      SELECT id
      FROM teacher_leaves
      WHERE teacher_id = :teacherId
        AND status IN ('pending', 'approved')
        AND daterange(from_date, to_date, '[]') && daterange(:fromDate, :toDate, '[]')
      LIMIT 1;
    `, {
      replacements: {
        teacherId: req.user.id,
        fromDate: from_date,
        toDate: to_date,
      },
    });

    if (overlap) {
      return res.fail('A pending or approved leave already overlaps this date range.', [], 422);
    }

    if (leave_type !== 'without_pay') {
      const [[balance]] = await sequelize.query(`
        SELECT remaining
        FROM leave_balances
        WHERE teacher_id = :teacherId
          AND session_id = :sessionId
          AND leave_type = :leaveType
        LIMIT 1;
      `, {
        replacements: {
          teacherId: req.user.id,
          sessionId: session?.id || 0,
          leaveType: leave_type,
        },
      });

      if (!balance) {
        return res.fail('Leave balance is not configured for this leave type.', [], 422);
      }

      if (Number(balance.remaining) < computed.daysCount) {
        return res.fail('Insufficient leave balance for the selected dates.', [], 422);
      }
    }

    const [[application]] = await sequelize.query(`
      INSERT INTO teacher_leaves (
        teacher_id, leave_type, from_date, to_date, days_count, reason, document_path,
        status, reviewed_by, review_note, reviewed_at, created_at, updated_at
      )
      VALUES (
        :teacherId, :leaveType, :fromDate, :toDate, :daysCount, :reason, :documentPath,
        'pending', NULL, NULL, NULL, NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        teacherId: req.user.id,
        leaveType: leave_type,
        fromDate: from_date,
        toDate: to_date,
        daysCount: computed.daysCount,
        reason,
        documentPath: document_path,
      },
    });

    await audit('teacher_leaves', application.id, {
      field: 'created',
      oldValue: null,
      newValue: leave_type,
      reason: 'Teacher leave application submitted',
    }, req);

    res.ok({
      application,
      session,
      computed_days: computed.daysCount,
      applicable_dates: computed.applicableDates,
    }, 'Leave application submitted.', 201);
  } catch (err) { next(err); }
};

exports.cancelLeave = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const teacherId = req.user.id;

    const [[leave]] = await sequelize.query(`
      SELECT id, status, leave_type, days_count
      FROM teacher_leaves
      WHERE id = :id AND teacher_id = :teacherId;
    `, { replacements: { id, teacherId } });

    if (!leave) return res.fail('Leave application not found.', [], 404);
    if (!['pending', 'approved'].includes(leave.status)) {
      return res.fail('Only pending or approved leave applications can be cancelled.', [], 422);
    }

    const oldStatus = leave.status;

    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        UPDATE teacher_leaves
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id }, transaction: t });

      if (oldStatus === 'approved' && leave.leave_type !== 'without_pay') {
        await sequelize.query(`
          UPDATE leave_balances
          SET used = GREATEST(used - :daysCount, 0),
              remaining = remaining + :daysCount,
              updated_at = NOW()
          WHERE teacher_id = :teacherId
            AND session_id = (
              SELECT id FROM sessions
              WHERE school_id = :schoolId
              ORDER BY CASE WHEN is_current=true THEN 0 ELSE 1 END,
                       start_date DESC
              LIMIT 1
            )
            AND leave_type = :leaveType;
        `, {
          replacements: {
            daysCount: leave.days_count,
            teacherId,
            schoolId,
            leaveType: leave.leave_type
          },
          transaction: t
        });
      }

      await audit('teacher_leaves', Number(id), {
        field: 'status',
        oldValue: oldStatus,
        newValue: 'cancelled',
        reason: 'Teacher cancelled own leave application',
      }, req);
    });

    res.ok({ id: Number(id) }, 'Leave application cancelled.');
  } catch (err) { next(err); }
};

exports.profile = async (req, res, next) => {
  try {
    const { assignments, scope, session } = await getTeacherContext(req);
    const [[user]] = await sequelize.query(`
      SELECT id, CONCAT(first_name, ' ', last_name) AS name, email, phone, employee_id, designation, department, joining_date, address, profile_photo, 'teacher' AS role,
             highest_qualification, specialization, university_name, graduation_year, years_of_experience
      FROM teachers
      WHERE id = :teacherId;
    `, { replacements: { teacherId: req.user.id } });

    const [correctionRequests] = await sequelize.query(`
      SELECT id, field_name, current_value, requested_value, reason, status, created_at
      FROM profile_correction_requests
      WHERE teacher_id = :teacherId
      ORDER BY created_at DESC
      LIMIT 8;
    `, { replacements: { teacherId: req.user.id } });

    let attendanceRate = { marked: 0, total: 0, on_time_rate: 0 };
    if (scope.sectionIds.length > 0) {
      const [[attendanceSummary]] = await sequelize.query(`
        SELECT
          COUNT(DISTINCT (a.date, e.section_id)) AS marked
        FROM attendance a
        JOIN enrollments e ON e.id = a.enrollment_id
        WHERE a.marked_by = :teacherId
          AND e.session_id = :sessionId;
      `, { replacements: { teacherId: req.user.id, sessionId: session?.id || 0 } });

      attendanceRate = {
        marked: Number(attendanceSummary?.marked || 0),
        total: Number(attendanceSummary?.marked || 0),
        on_time_rate: attendanceSummary?.marked ? 100 : 0,
      };
    }

    const [[marksSummary]] = await sequelize.query(`
      SELECT
        SUM(CASE WHEN ex.status = 'published' THEN 1 ELSE 0 END) AS published_exams,
        SUM(CASE WHEN ex.status = 'published'
            AND NOT EXISTS (
              SELECT 1
              FROM enrollments e
              JOIN teacher_assignments ta
                ON ta.class_id = e.class_id
               AND ta.section_id = e.section_id
               AND ta.session_id = e.session_id
               AND ta.teacher_id = :teacherId
               AND ta.is_active = true
               AND ta.subject_id IS NOT NULL
              LEFT JOIN exam_results er
                ON er.exam_id = ex.id
               AND er.enrollment_id = e.id
               AND er.subject_id = ta.subject_id
              WHERE e.class_id = ex.class_id
                AND e.session_id = ex.session_id
                AND e.status = 'active'
                AND er.id IS NULL
            ) THEN 1 ELSE 0 END) AS completed_exams
      FROM exams ex
      WHERE ex.session_id = :sessionId;
    `, { replacements: { teacherId: req.user.id, sessionId: session?.id || 0 } });

    const performance_summary = {
      attendance_marking_rate: attendanceRate,
      marks_entry_completion_rate: {
        completed: Number(marksSummary?.completed_exams || 0),
        total: Number(marksSummary?.published_exams || 0),
        percentage: Number(marksSummary?.published_exams || 0)
          ? Math.round((Number(marksSummary?.completed_exams || 0) / Number(marksSummary?.published_exams || 0)) * 100)
          : 0,
      },
    };

    res.ok({ profile: user, assignments, correction_requests: correctionRequests, performance_summary }, 'Teacher profile loaded.');
  } catch (err) { next(err); }
};

exports.updateProfileContact = async (req, res, next) => {
  try {
    const allowed = ['phone', 'email', 'address'];
    const changes = allowed.filter((field) => req.body[field] !== undefined);
    if (changes.length === 0) return res.fail('No contact fields provided.', [], 422);

    const [[currentUser]] = await sequelize.query(`
      SELECT phone, email, address
      FROM teachers
      WHERE id = :teacherId;
    `, { replacements: { teacherId: req.user.id } });

    const created = [];
    for (const field of changes) {
      const [[requestRow]] = await sequelize.query(`
        INSERT INTO profile_correction_requests (
          teacher_id, field_name, current_value, requested_value, reason,
          status, reviewed_by, review_note, reviewed_at, created_at, updated_at
        )
        VALUES (
          :teacherId, :fieldName, :currentValue, :requestedValue, :reason,
          'pending', NULL, NULL, NULL, NOW(), NOW()
        )
        RETURNING *;
      `, {
        replacements: {
          teacherId: req.user.id,
          fieldName: field,
          currentValue: currentUser[field],
          requestedValue: req.body[field],
          reason: req.body.reason || `Contact correction requested for ${field}`,
        },
      });
      created.push(requestRow);
    }

    await audit('teacher_profile', req.user.id, {
      field: 'contact_correction_request',
      oldValue: null,
      newValue: changes.join(','),
      reason: req.body.reason || 'Teacher requested profile contact correction',
    }, req);

    res.ok({ requests: created }, 'Contact correction request submitted.');
  } catch (err) { next(err); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    requireFields(req.body, ['current_password', 'new_password']);

    const [[user]] = await sequelize.query(`
      SELECT id, password_hash
      FROM teachers
      WHERE id = :teacherId;
    `, { replacements: { teacherId: req.user.id } });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.fail('Current password is incorrect.', [], 401);

    const hash = await bcrypt.hash(new_password, 12);
    await sequelize.query(`
      UPDATE teachers
      SET password_hash = :hash,
          force_password_change = false,
          last_password_change = NOW(),
          updated_at = NOW()
      WHERE id = :teacherId;
    `, { replacements: { hash, teacherId: req.user.id } });

    await audit('teacher_profile', req.user.id, {
      field: 'password_change',
      oldValue: null,
      newValue: 'changed',
      reason: 'Teacher changed own password',
    }, req);

    res.ok({}, 'Password changed successfully.');
  } catch (err) { next(err); }
};

exports.createCorrectionRequest = async (req, res, next) => {
  try {
    const { field_name, current_value = null, requested_value, reason } = req.body;
    requireFields(req.body, ['field_name', 'requested_value', 'reason']);

    const [[requestRow]] = await sequelize.query(`
      INSERT INTO profile_correction_requests (
        teacher_id, field_name, current_value, requested_value, reason,
        status, reviewed_by, review_note, reviewed_at, created_at, updated_at
      )
      VALUES (
        :teacherId, :fieldName, :currentValue, :requestedValue, :reason,
        'pending', NULL, NULL, NULL, NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        teacherId: req.user.id,
        fieldName: field_name,
        currentValue: current_value,
        requestedValue: requested_value,
        reason,
      },
    });

    await audit('teacher_profile', req.user.id, {
      field: 'correction_request',
      oldValue: current_value,
      newValue: requested_value,
      reason,
    }, req);

    res.ok({ request: requestRow }, 'Correction request submitted.', 201);
  } catch (err) { next(err); }
};

exports.studyMaterialList = async (req, res, next) => {
  try {
    const { session } = await getTeacherContext(req);
    const { class_id, subject_id } = req.query;

    const [materials] = await sequelize.query(`
      SELECT
        sm.*,
        c.name AS class_name,
        sub.name AS subject_name,
        (SELECT COUNT(*) FROM material_views mv WHERE mv.material_id = sm.id) AS view_count
      FROM study_materials sm
      JOIN classes c ON c.id = sm.class_id
      JOIN subjects sub ON sub.id = sm.subject_id
      WHERE sm.teacher_id = :teacherId
        AND sm.session_id = :sessionId
        AND (:classId::int IS NULL OR sm.class_id = :classId)
        AND (:subjectId::int IS NULL OR sm.subject_id = :subjectId)
      ORDER BY sm.created_at DESC;
    `, {
      replacements: {
        teacherId: req.user.id,
        sessionId: session?.id || 0,
        classId: class_id || null,
        subjectId: subject_id || null,
      },
    });

    res.ok({ materials }, `${materials.length} study material(s) found.`);
  } catch (err) { next(err); }
};

exports.createStudyMaterial = async (req, res, next) => {
  try {
    const { class_id, subject_id, title, description = null } = req.body;
    requireFields(req.body, ['class_id', 'subject_id', 'title']);

    if (!req.file) {
      return res.fail('Study material file is required.', [], 422);
    }

    const { session, scope } = await getTeacherContext(req);
    assertAccess(scope, Number(class_id), null, Number(subject_id));

    const filePath = req.file.path.replace(/\\/g, '/');
    const fileType = req.file.mimetype;
    const fileSize = req.file.size;

    const [[material]] = await sequelize.query(`
      INSERT INTO study_materials (
        class_id, subject_id, teacher_id, session_id, title, description,
        file_path, file_type, file_size, is_active, created_at, updated_at
      )
      VALUES (
        :classId, :subjectId, :teacherId, :sessionId, :title, :description,
        :filePath, :fileType, :fileSize, true, NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        classId: class_id,
        subjectId: subject_id,
        teacherId: req.user.id,
        sessionId: session?.id || 0,
        title,
        description,
        filePath,
        fileType,
        fileSize,
      },
    });

    await audit('study_materials', material.id, {
      field: 'created',
      oldValue: null,
      newValue: title,
      reason: 'Teacher uploaded study material',
    }, req);

    res.ok({ material }, 'Study material uploaded successfully.', 201);
  } catch (err) { next(err); }
};

exports.deleteStudyMaterial = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[material]] = await sequelize.query(`
      SELECT id, title, file_path FROM study_materials
      WHERE id = :id AND teacher_id = :teacherId
      LIMIT 1;
    `, { replacements: { id, teacherId: req.user.id } });

    if (!material) return res.fail('Study material not found.', [], 404);

    await sequelize.transaction(async (t) => {
      await sequelize.query(`DELETE FROM material_views WHERE material_id = :id;`, { replacements: { id }, transaction: t });
      await sequelize.query(`DELETE FROM study_materials WHERE id = :id;`, { replacements: { id }, transaction: t });
    });

    // Optionally delete file from disk
    const fullPath = path.join(__dirname, '..', material.file_path);
    const fs = require('fs');
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    await audit('study_materials', Number(id), {
      field: 'deleted',
      oldValue: material.title,
      newValue: null,
      reason: 'Teacher deleted study material',
    }, req);

    res.ok({ id: Number(id) }, 'Study material deleted successfully.');
  } catch (err) { next(err); }
};
