'use strict';

const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const { recomputeStudentAchievements } = require('../utils/achievementEngine');
const { sendNotification } = require('../utils/notification');

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const forbiddenTracker = new Map();

const todayDate = () => new Date().toISOString().slice(0, 10);

function getDaysRemaining(eventDate) {
  try {
    const event = new Date(eventDate);
    event.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = event.getTime() - today.getTime();
    return Math.max(Math.ceil(diffTime / (1000 * 60 * 60 * 24)), 0);
  } catch (e) {
    return 0;
  }
}

const roundNumber = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const getStudentName = (student) => [student.first_name, student.last_name].filter(Boolean).join(' ').trim();

function attendanceBand(percentage) {
  const pct = Number(percentage || 0);
  if (pct >= 85) return 'good';
  if (pct >= 75) return 'okay';
  if (pct >= 65) return 'warning';
  return 'critical';
}

function gradeColor(grade) {
  if (grade === 'A+') return 'dark_green';
  if (grade === 'A') return 'green';
  if (grade === 'B') return 'teal';
  if (grade === 'C') return 'blue';
  if (grade === 'D') return 'amber';
  return 'red';
}

function recordForbiddenAttempt(req, studentId, reason, extra = {}) {
  const key = String(studentId || req.user?.student_id || req.user?.id || 'unknown');
  const count = (forbiddenTracker.get(key) || 0) + 1;
  forbiddenTracker.set(key, count);

  logger.warn(`[student-portal-403] student=${key} count=${count} reason=${reason}`, {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    ...extra,
  });

  if (count >= 3) {
    logger.warn(`[student-portal-suspicious] student=${key} repeated forbidden access attempts`, {
      count,
      path: req.originalUrl,
      ip: req.ip,
    });
  }
}

function assertNoStudentIdOverride(req, studentId) {
  const candidates = [
    req.params?.student_id,
    req.params?.studentId,
    req.query?.student_id,
    req.query?.studentId,
    req.body?.student_id,
    req.body?.studentId,
  ].filter((value) => value !== undefined && value !== null && value !== '');

  for (const candidate of candidates) {
    if (Number(candidate) !== Number(studentId)) {
      const error = new Error('You are not allowed to access another student record.');
      error.status = 403;
      throw error;
    }
  }
}

async function getStudentContext(req, { requireEnrollment = true } = {}) {
  if (req.user?.role !== 'student') {
    const error = new Error('Student access only.');
    error.status = 403;
    throw error;
  }

  const studentId = Number(req.user.student_id || req.user.id);
  assertNoStudentIdOverride(req, studentId);

  const [[student]] = await sequelize.query(`
  SELECT
    s.id,
    s.school_id,
    COALESCE(sch.upi_name, sch.name) AS school_name,
    sch.upi_id AS school_upi_id,      s.admission_no,
      s.first_name,
      s.last_name,
      s.date_of_birth,
      s.gender,
      sp.address,
      sp.city,
      sp.state,
      sp.pincode,
      sp.phone,
      sp.email,
      sp.father_name,
      sp.father_phone,
      sp.father_occupation,
      sp.mother_name,
      sp.mother_phone,
      sp.mother_email,
      sp.emergency_contact,
      sp.blood_group,
      sp.medical_notes,
      sp.photo_path,
      e.id AS enrollment_id,
      e.session_id,
      e.class_id,
      e.section_id,
      e.roll_number,
      e.joined_date,
      e.joining_type,
      e.status AS enrollment_status,
      cls.name AS class_name,
      sec.name AS section_name,
      sess.name AS session_name,
      class_teacher.name AS class_teacher_name
    FROM students s
    JOIN schools sch ON sch.id = s.school_id
    LEFT JOIN student_profiles sp
      ON sp.student_id = s.id
     AND sp.is_current = true
    LEFT JOIN LATERAL (
      SELECT en.*
      FROM enrollments en
      WHERE en.student_id = s.id
      ORDER BY CASE WHEN en.status = 'active' THEN 0 ELSE 1 END, en.joined_date DESC, en.id DESC
      LIMIT 1
    ) e ON true
    LEFT JOIN classes cls ON cls.id = e.class_id
    LEFT JOIN sections sec ON sec.id = e.section_id
    LEFT JOIN sessions sess ON sess.id = e.session_id
    LEFT JOIN LATERAL (
      SELECT CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM teacher_assignments ta
      JOIN teachers u ON u.id = ta.teacher_id
      WHERE ta.session_id = e.session_id
        AND ta.class_id = e.class_id
        AND ta.section_id = e.section_id
        AND ta.is_class_teacher = true
        AND ta.is_active = true
      ORDER BY ta.id DESC
      LIMIT 1
    ) class_teacher ON true
    WHERE s.id = :studentId
      AND s.school_id = :schoolId
      AND s.is_deleted = false
      AND s.is_active = true
    LIMIT 1;
  `, {
    replacements: {
      studentId,
      schoolId: req.user.school_id,
    },
  });

  if (!student) {
    const error = new Error('Student account not found or inactive.');
    error.status = 401;
    throw error;
  }

  if (requireEnrollment && !student.enrollment_id) {
    const error = new Error('No active academic enrollment found for this student.');
    error.status = 404;
    throw error;
  }

  return {
    student,
    studentId,
    enrollmentId: student.enrollment_id ? Number(student.enrollment_id) : null,
    classId: student.class_id ? Number(student.class_id) : null,
    sectionId: student.section_id ? Number(student.section_id) : null,
    sessionId: student.session_id ? Number(student.session_id) : null,
    school: {
      id: student.school_id,
      name: student.school_name,
      upi_id: student.school_upi_id
    }
  };
}

async function getAttendanceSummary(enrollmentId) {
  const [[summary]] = await sequelize.query(`
    SELECT
      SUM(CASE WHEN status <> 'holiday' THEN 1 ELSE 0 END) AS working_days,
      SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present_days,
      SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent_days,
      SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late_days,
      SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) AS half_days,
      ROUND(
        (
          SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END)
          + SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) * 0.5
        ) / NULLIF(SUM(CASE WHEN status <> 'holiday' THEN 1 ELSE 0 END), 0) * 100,
        2
      ) AS percentage
    FROM attendance
    WHERE enrollment_id = :enrollmentId;
  `, { replacements: { enrollmentId } });

  const percentage = Number(summary?.percentage || 0);
  const workingDays = Number(summary?.working_days || 0);
  const presentDays = Number(summary?.present_days || 0);
  const minimumTargetDays = Math.ceil(workingDays * 0.75);

  return {
    working_days: workingDays,
    present_days: presentDays,
    absent_days: Number(summary?.absent_days || 0),
    late_days: Number(summary?.late_days || 0),
    half_days: Number(summary?.half_days || 0),
    percentage,
    band: attendanceBand(percentage),
    days_needed_for_minimum: Math.max(minimumTargetDays - presentDays, 0),
  };
}

async function getSharedStudentRemarks(studentId, enrollmentId = null, { limit = 10 } = {}) {
  const [rows] = await sequelize.query(`
    SELECT
      sr.id,
      sr.remark_type,
      sr.remark_text,
      sr.visibility,
      sr.created_at,
      CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name
    FROM student_remarks sr
    JOIN teachers teacher ON teacher.id = sr.teacher_id
    WHERE sr.student_id = :studentId
      AND sr.is_deleted = false
      AND sr.visibility IN ('share_student', 'share_parent')
      AND (:enrollmentId::int IS NULL OR sr.enrollment_id = :enrollmentId)
    ORDER BY sr.created_at DESC, sr.id DESC
    LIMIT :limit;
  `, {
    replacements: {
      studentId,
      enrollmentId,
      limit,
    },
  });

  return rows;
}

async function getTodaySchedule(context) {
  const dayName = DAY_NAMES[new Date().getDay()];
  if (dayName === 'sunday') return [];

  const [rows] = await sequelize.query(`
    SELECT
      ts.id,
      ts.period_number,
      ts.start_time,
      ts.end_time,
      ts.room_number,
      sub.id AS subject_id,
      sub.name AS subject_name,
      sub.code AS subject_code,
      teacher.id AS teacher_id,
      CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name
    FROM timetable_slots ts
    JOIN subjects sub ON sub.id = ts.subject_id
    JOIN teachers teacher ON teacher.id = ts.teacher_id
    JOIN teacher_assignments ta
      ON ta.session_id = ts.session_id
     AND ta.class_id = ts.class_id
     AND ta.section_id = ts.section_id
     AND ta.teacher_id = ts.teacher_id
     AND ta.subject_id = ts.subject_id
     AND ta.is_active = true
    WHERE ts.session_id = :sessionId
      AND ts.class_id = :classId
      AND ts.section_id = :sectionId
      AND ts.day_of_week = :dayName
      AND ts.is_active = true
    ORDER BY ts.start_time ASC, ts.period_number ASC;
  `, {
    replacements: {
      sessionId: context.sessionId,
      classId: context.classId,
      sectionId: context.sectionId,
      dayName,
    },
  });

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  // Check online status in Redis for each teacher
  return Promise.all(rows.map(async (row) => {
    const [startHour, startMinute] = String(row.start_time).slice(0, 5).split(':').map(Number);
    const [endHour, endMinute] = String(row.end_time).slice(0, 5).split(':').map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;

    let status = 'upcoming';
    let countdown_minutes = null;
    if (currentMinutes >= start && currentMinutes < end) {
      status = 'current';
      countdown_minutes = end - currentMinutes;
    } else if (currentMinutes >= end) {
      status = 'done';
    } else {
      countdown_minutes = start - currentMinutes;
    }

    let is_online = false;
    if (redis.status === 'ready' && row.teacher_id) {
      const key = `online:${context.student.school_id}:teacher:${row.teacher_id}`;
      const val = await redis.get(key);
      is_online = val === '1';
    }

    return { ...row, status, countdown_minutes, is_online };
  }));
}

async function getLatestExamResult(context) {
  // Fee check for withholding
  const feeSummary = await getFeeSummary(context);
  const [[sr]] = await sequelize.query(`
    SELECT release_result FROM student_results WHERE enrollment_id = :enrollmentId LIMIT 1;
  `, { replacements: { enrollmentId: context.enrollmentId } });
  
  const isWithheld = feeSummary.total_pending > 0 && !sr?.release_result;

  if (isWithheld) return { is_withheld: true, total_pending: feeSummary.total_pending };

  const [[row]] = await sequelize.query(`
    SELECT
      ex.id AS exam_id,
      ex.name AS exam_name,
      ex.exam_type,
      ex.start_date,
      ROUND(
        SUM(COALESCE(er.marks_obtained, COALESCE(er.theory_marks_obtained, 0) + COALESCE(er.practical_marks_obtained, 0)))
        / NULLIF(SUM(COALESCE(sub.combined_total_marks, 0)), 0) * 100,
        2
      ) AS percentage,
      MIN(CASE WHEN er.is_pass = false OR er.is_absent = true THEN 0 ELSE 1 END) AS all_passed,
      MAX(CASE WHEN er.is_pass = false AND sub.is_core = true THEN 1 ELSE 0 END) AS has_core_failure
    FROM exams ex
    JOIN exam_results er
      ON er.exam_id = ex.id
     AND er.enrollment_id = :enrollmentId
    JOIN subjects sub ON sub.id = er.subject_id
    WHERE ex.session_id = :sessionId
      AND ex.class_id = :classId
    GROUP BY ex.id, ex.name, ex.exam_type, ex.start_date
    ORDER BY ex.start_date DESC, ex.id DESC
    LIMIT 1;
  `, {
    replacements: {
      enrollmentId: context.enrollmentId,
      sessionId: context.sessionId,
      classId: context.classId,
    },
  });

  if (!row) return null;

  const percentage = Number(row.percentage || 0);
  let grade = 'F';
  if (percentage >= 90) grade = 'A+';
  else if (percentage >= 80) grade = 'A';
  else if (percentage >= 70) grade = 'B';
  else if (percentage >= 60) grade = 'C';
  else if (percentage >= 50) grade = 'D';

  let result_status = 'fail';
  if (Number(row.all_passed) === 1) result_status = 'pass';
  else if (Number(row.has_core_failure) === 1) result_status = 'compartment';

  return {
    exam_id: row.exam_id,
    exam_name: row.exam_name,
    exam_type: row.exam_type,
    start_date: row.start_date,
    percentage,
    grade,
    grade_color: gradeColor(grade),
    result_status,
    is_withheld: false
  };
}

async function getFeeSummary(context) {
  const [[summary]] = await sequelize.query(`
    SELECT
      COUNT(*) AS total_invoices,
      COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS total_fee,
      COALESCE(SUM(fi.amount_paid), 0) AS total_paid,
      COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS total_pending,
      MIN(fi.due_date) FILTER (
        WHERE fi.status IN ('pending', 'partial')
          AND (fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid) > 0
      ) AS next_due_date
    FROM fee_invoices fi
    WHERE fi.enrollment_id = :enrollmentId;
  `, { replacements: { enrollmentId: context.enrollmentId } });

  return {
    total_invoices: Number(summary?.total_invoices || 0),
    total_fee: roundNumber(summary?.total_fee),
    total_paid: roundNumber(summary?.total_paid),
    total_pending: roundNumber(summary?.total_pending),
    next_due_date: summary?.next_due_date || null,
    status: Number(summary?.total_pending || 0) > 0 ? 'pending' : 'clear',
  };
}

async function getRecentAttendanceStrip(context) {
  const [rows] = await sequelize.query(`
    SELECT date, status, marked_at
    FROM attendance
    WHERE enrollment_id = :enrollmentId
    ORDER BY date DESC
    LIMIT 7;
  `, { replacements: { enrollmentId: context.enrollmentId } });

  return rows.reverse();
}

async function getHomeworkDueToday(context) {
  const [rows] = await sequelize.query(`
    SELECT
      h.id,
      h.title,
      h.description,
      h.due_date,
      h.submission_type,
      sub.name AS subject_name,
      CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name,
      COALESCE(hs.status, 'pending') AS submission_status
    FROM homework h
    JOIN subjects sub ON sub.id = h.subject_id
    JOIN teachers teacher ON teacher.id = h.teacher_id
    LEFT JOIN homework_submissions hs
      ON hs.homework_id = h.id
     AND hs.enrollment_id = :enrollmentId
    WHERE h.session_id = :sessionId
      AND h.class_id = :classId
      AND h.section_id = :sectionId
      AND h.status = 'active'
      AND h.due_date = CURRENT_DATE
      AND COALESCE(hs.status, 'pending') = 'pending'
    ORDER BY h.id DESC;
  `, {
    replacements: {
      enrollmentId: context.enrollmentId,
      sessionId: context.sessionId,
      classId: context.classId,
      sectionId: context.sectionId,
    },
  });
  return rows;
}

async function getUpcomingEvents(context) {
  const [exams] = await sequelize.query(`
    SELECT 'exam' AS event_type, id, name AS title, start_date AS event_date
    FROM exams
    WHERE session_id = :sessionId
      AND class_id = :classId
      AND start_date >= CURRENT_DATE
    ORDER BY start_date ASC
    LIMIT 5;
  `, {
    replacements: {
      sessionId: context.sessionId,
      classId: context.classId,
    },
  });

  const [fees] = await sequelize.query(`
    SELECT 'fee' AS event_type, fi.id, fs.name AS title, fi.due_date AS event_date
    FROM fee_invoices fi
    JOIN fee_structures fs ON fs.id = fi.fee_structure_id
    WHERE fi.enrollment_id = :enrollmentId
      AND fi.due_date >= CURRENT_DATE
      AND fi.status IN ('pending', 'partial')
    ORDER BY fi.due_date ASC
    LIMIT 5;
  `, { replacements: { enrollmentId: context.enrollmentId } });

  const [holidays] = await sequelize.query(`
    SELECT 'holiday' AS event_type, id, name AS title, holiday_date AS event_date
    FROM session_holidays
    WHERE session_id = :sessionId
      AND holiday_date >= CURRENT_DATE
    ORDER BY holiday_date ASC
    LIMIT 5;
  `, { replacements: { sessionId: context.sessionId } });

  const [notices] = await sequelize.query(`
    SELECT 
      'notice' AS event_type, 
      n.id, 
      n.title, 
      COALESCE(n.expiry_date::date, n.publish_date::date) AS event_date,
      COALESCE(NULLIF(TRIM(CONCAT(poster.first_name, ' ', poster.last_name)), ''), admin.name, 'School') AS posted_by,
      COALESCE(n.created_by_role, 'teacher') AS posted_by_role,
      COALESCE(NULLIF(TRIM(CONCAT(poster.first_name, ' ', poster.last_name)), ''), admin.name, 'School') AS teacher_name,
      COALESCE(n.created_by_role, 'teacher') AS teacher_role
    FROM teacher_notices n
    LEFT JOIN teachers poster ON poster.id = n.teacher_id
    LEFT JOIN users admin ON admin.id = n.created_by_user_id
    WHERE n.is_active = true
      AND (
        (n.target_scope = 'my_class_only' AND n.class_id = :classId AND n.section_id = :sectionId)
        OR (n.target_scope = 'specific_section' AND n.class_id = :classId AND n.section_id = :sectionId)
        OR n.target_scope = 'all_students'
        OR n.target_scope = 'whole_school'
      )
      AND COALESCE(n.expiry_date::date, n.publish_date::date) >= CURRENT_DATE
    ORDER BY COALESCE(n.expiry_date::date, n.publish_date::date) ASC
    LIMIT 5;
  `, {
    replacements: {
      classId: context.classId,
      sectionId: context.sectionId,
    },
  });

  return [...exams, ...fees, ...holidays, ...notices]
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))
    .slice(0, 10)
    .map((event) => ({
      ...event,
      days_remaining: getDaysRemaining(event.event_date),
    }));
}

async function getAttendanceStreak(enrollmentId) {
  const [rows] = await sequelize.query(`
    SELECT date, status
    FROM attendance
    WHERE enrollment_id = :enrollmentId
      AND date <= CURRENT_DATE
      AND status <> 'holiday'
    ORDER BY date DESC
    LIMIT 30;
  `, { replacements: { enrollmentId } });

  let streak = 0;
  for (const row of rows) {
    if (['present', 'late', 'half_day'].includes(row.status)) streak += 1;
    else break;
  }
  return streak;
}

async function ensureOwnedInvoice(req, context, invoiceId) {
  const [[owned]] = await sequelize.query(`
    SELECT id FROM fee_invoices WHERE id = :invoiceId AND enrollment_id = :enrollmentId LIMIT 1;
  `, { replacements: { invoiceId, enrollmentId: context.enrollmentId } });
  if (owned) return true;

  const [[exists]] = await sequelize.query(`SELECT id FROM fee_invoices WHERE id = :invoiceId LIMIT 1;`, { replacements: { invoiceId } });
  if (exists) {
    recordForbiddenAttempt(req, context.studentId, 'invoice_access', { invoiceId });
    const error = new Error('You are not allowed to access this invoice.');
    error.status = 403;
    throw error;
  }
  return false;
}

async function ensureOwnedHomework(req, context, homeworkId) {
  const [[owned]] = await sequelize.query(`
    SELECT id
    FROM homework
    WHERE id = :homeworkId
      AND session_id = :sessionId
      AND class_id = :classId
      AND section_id = :sectionId
    LIMIT 1;
  `, {
    replacements: {
      homeworkId,
      sessionId: context.sessionId,
      classId: context.classId,
      sectionId: context.sectionId,
    },
  });
  if (owned) return true;

  const [[exists]] = await sequelize.query(`SELECT id FROM homework WHERE id = :homeworkId LIMIT 1;`, { replacements: { homeworkId } });
  if (exists) {
    recordForbiddenAttempt(req, context.studentId, 'homework_access', { homeworkId });
    const error = new Error('You are not allowed to access this homework.');
    error.status = 403;
    throw error;
  }
  return false;
}

async function ensureOwnedNotice(req, context, noticeId) {
  const [[ownedTeacher]] = await sequelize.query(`
    SELECT id FROM teacher_notices
    WHERE id = :noticeId AND is_active = true
      AND (
        target_scope = 'all_students'
        OR (target_scope = 'specific_student' AND target_student_id = :studentId)
        OR (target_scope IN ('my_class_only', 'whole_class') AND class_id = :classId AND section_id = :sectionId)
        OR (target_scope = 'specific_section' AND class_id = :classId AND (section_id IS NULL OR section_id = :sectionId))
      )
    LIMIT 1;
  `, {
    replacements: { noticeId, studentId: context.studentId, classId: context.classId, sectionId: context.sectionId },
  });
  if (ownedTeacher) return true;

  const [[ownedUnified]] = await sequelize.query(`
    SELECT id FROM notices
    WHERE id = :noticeId AND is_deleted = false
      AND (
        audience = 'school_wide'
        OR (audience = 'student' AND target_student_id = :studentId)
        OR (audience = 'class' AND target_class_id = :classId)
        OR (audience = 'section' AND target_class_id = :classId AND (target_section_id IS NULL OR target_section_id = :sectionId))
      )
    LIMIT 1;
  `, {
    replacements: { noticeId, studentId: context.studentId, classId: context.classId, sectionId: context.sectionId },
  });
  if (ownedUnified) return true;

  const [[exists]] = await sequelize.query(`
    SELECT id FROM teacher_notices WHERE id = :noticeId
    UNION
    SELECT id FROM notices WHERE id = :noticeId
    LIMIT 1;
  `, { replacements: { noticeId } });

  if (exists) {
    recordForbiddenAttempt(req, context.studentId, 'notice_access', { noticeId });
    const error = new Error('You are not allowed to access this notice.');
    error.status = 403;
    throw error;
  }
  return false;
}

async function ensureOwnedMaterial(req, context, materialId) {
  const [[owned]] = await sequelize.query(`
    SELECT id
    FROM study_materials
    WHERE id = :materialId
      AND session_id = :sessionId
      AND class_id = :classId
      AND is_active = true
    LIMIT 1;
  `, {
    replacements: {
      materialId,
      sessionId: context.sessionId,
      classId: context.classId,
    },
  });
  if (owned) return true;

  const [[exists]] = await sequelize.query(`SELECT id FROM study_materials WHERE id = :materialId LIMIT 1;`, { replacements: { materialId } });
  if (exists) {
    recordForbiddenAttempt(req, context.studentId, 'material_access', { materialId });
    const error = new Error('You are not allowed to access this study material.');
    error.status = 403;
    throw error;
  }
  return false;
}

async function getAchievementsData(studentId, sessionId = null) {
  const [rows] = await sequelize.query(`
    SELECT id, achievement_type, earned_for, earned_at, session_id
    FROM student_achievements
    WHERE student_id = :studentId
      AND (:sessionId::int IS NULL OR session_id = :sessionId)
    ORDER BY earned_at DESC, id DESC;
  `, { replacements: { studentId, sessionId } });
  return rows;
}

async function ensureAchievementsFresh(context) {
  if (!context?.studentId || !context?.sessionId || !context?.enrollmentId) {
    return getAchievementsData(context?.studentId, context?.sessionId || null);
  }

  return recomputeStudentAchievements({
    studentId: context.studentId,
    sessionId: context.sessionId,
    enrollmentId: context.enrollmentId,
  });
}

exports.dashboard = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const attendance = await getAttendanceSummary(context.enrollmentId);
    const latest_result = await getLatestExamResult(context);
    const fee = await getFeeSummary(context);
    const schedule = await getTodaySchedule(context);
    const attendance_strip = await getRecentAttendanceStrip(context);
    const upcoming_events = await getUpcomingEvents(context);
    const homework_due_today = await getHomeworkDueToday(context);
    const achievements = await ensureAchievementsFresh(context);
    const streak = await getAttendanceStreak(context.enrollmentId);
    const current_period = schedule.find((item) => item.status === 'current') || null;
    const next_period = schedule.find((item) => item.status === 'upcoming') || null;
    const isBirthday = context.student.date_of_birth ? String(context.student.date_of_birth).slice(5) === todayDate().slice(5) : false;

    res.ok({
      student: {
        id: context.student.id,
        name: getStudentName(context.student),
        admission_no: context.student.admission_no,
        class_name: context.student.class_name,
        section_name: context.student.section_name,
        roll_number: context.student.roll_number,
        session_name: context.student.session_name,
      },
      today: todayDate(),
      attendance,
      latest_result,
      fee,
      classes_today: { total_periods: schedule.length, current_period, next_period },
      today_schedule: schedule,
      recent_attendance: attendance_strip,
      upcoming_events,
      homework_due_today: { count: homework_due_today.length, items: homework_due_today },
      motivational: streak >= 3
        ? { type: 'streak', streak_days: streak, message: `You have attended ${streak} days in a row! Keep it up!` }
        : (attendance && attendance.percentage < 75)
          ? { type: 'gentle_reminder', message: 'Your attendance needs attention. Talk to your class teacher.' }
          : null,
      birthday_banner: isBirthday ? { title: `Happy Birthday ${getStudentName(context.student)}!`, confetti: true } : null,
      achievements: (achievements || []).slice(0, 6),
    }, 'Student dashboard loaded.');
  } catch (err) {
    if (err.status === 403) recordForbiddenAttempt(req, req.user?.student_id || req.user?.id, err.message);
    next(err);
  }
};

exports.dashboardTodaySchedule = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const schedule = await getTodaySchedule(context);
    res.ok({ schedule }, `${schedule.length} class(es) found for today.`);
  } catch (err) { next(err); }
};

exports.dashboardUpcomingEvents = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const events = await getUpcomingEvents(context);
    res.ok({ events }, `${events.length} upcoming event(s) found.`);
  } catch (err) { next(err); }
};

exports.dashboardAchievements = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const achievements = await ensureAchievementsFresh(context);
    res.ok({ achievements }, `${achievements.length} achievement(s) found.`);
  } catch (err) { next(err); }
};

exports.attendance = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const now = new Date();
    const month = Number(req.query.month || now.getMonth() + 1);
    const year = Number(req.query.year || now.getFullYear());
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
    const summary = await getAttendanceSummary(context.enrollmentId);

    const [records] = await sequelize.query(`
      SELECT a.id, a.date, a.status, a.method, a.marked_at, a.override_reason, 
             COALESCE(marker_u.name, CONCAT(marker_t.first_name, ' ', marker_t.last_name)) AS marked_by_name
      FROM attendance a
      LEFT JOIN users marker_u ON marker_u.id = a.marked_by
      LEFT JOIN teachers marker_t ON marker_t.id = a.marked_by
      WHERE a.enrollment_id = :enrollmentId
        AND a.date BETWEEN :monthStart AND :monthEnd
      ORDER BY a.date ASC;
    `, {
      replacements: {
        enrollmentId: context.enrollmentId,
        monthStart,
        monthEnd,
      },
    });

    const [[monthly]] = await sequelize.query(`
      SELECT
        COUNT(*) FILTER (WHERE status <> 'holiday') AS working_days,
        COUNT(*) FILTER (WHERE status = 'present') AS present_days,
        COUNT(*) FILTER (WHERE status = 'absent') AS absent_days,
        COUNT(*) FILTER (WHERE status = 'late') AS late_days,
        COUNT(*) FILTER (WHERE status = 'half_day') AS half_days,
        ROUND(
          (
            COUNT(*) FILTER (WHERE status IN ('present', 'late'))
            + COUNT(*) FILTER (WHERE status = 'half_day') * 0.5
          ) / NULLIF(COUNT(*) FILTER (WHERE status <> 'holiday'), 0) * 100,
          2
        ) AS percentage
      FROM attendance
      WHERE enrollment_id = :enrollmentId
        AND date BETWEEN :monthStart AND :monthEnd;
    `, {
      replacements: {
        enrollmentId: context.enrollmentId,
        monthStart,
        monthEnd,
      },
    });

    res.ok({
      summary,
      selected_month: { month, year },
      records,
      monthly_summary: {
        working_days: Number(monthly?.working_days || 0),
        present_days: Number(monthly?.present_days || 0),
        absent_days: Number(monthly?.absent_days || 0),
        late_days: Number(monthly?.late_days || 0),
        half_days: Number(monthly?.half_days || 0),
        percentage: Number(monthly?.percentage || 0),
      },
    }, 'Attendance loaded.');
  } catch (err) { next(err); }
};

exports.attendanceSummary = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const summary = await getAttendanceSummary(context.enrollmentId);
    res.ok(summary, 'Attendance summary loaded.');
  } catch (err) { next(err); }
};

exports.attendanceTrend = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const [rows] = await sequelize.query(`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE) - interval '5 months',
          date_trunc('month', CURRENT_DATE),
          interval '1 month'
        )::date AS month_start
      )
      SELECT
        to_char(m.month_start, 'Mon YYYY') AS month_label,
        ROUND(
          (
            COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))
            + COUNT(a.id) FILTER (WHERE a.status = 'half_day') * 0.5
          ) / NULLIF(COUNT(a.id) FILTER (WHERE a.status <> 'holiday'), 0) * 100,
          2
        ) AS percentage
      FROM months m
      LEFT JOIN attendance a
        ON a.enrollment_id = :enrollmentId
       AND date_trunc('month', a.date) = date_trunc('month', m.month_start)
      GROUP BY m.month_start
      ORDER BY m.month_start ASC;
    `, { replacements: { enrollmentId: context.enrollmentId } });

    res.ok({ trend: rows.map((row) => ({ ...row, band: attendanceBand(row.percentage) })) }, 'Attendance trend loaded.');
  } catch (err) { next(err); }
};

exports.results = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    await ensureAchievementsFresh(context);

    // Fee check
    const feeSummary = await getFeeSummary(context);
    const [[sr]] = await sequelize.query(`
      SELECT release_result FROM student_results WHERE enrollment_id = :enrollmentId LIMIT 1;
    `, { replacements: { enrollmentId: context.enrollmentId } });
    
    const isWithheld = feeSummary.total_pending > 0 && !sr?.release_result;

    const [rows] = await sequelize.query(`
      SELECT
        ex.id,
        ex.name,
        ex.exam_type,
        ex.start_date,
        ex.end_date,
        ex.status,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM exam_results er
            WHERE er.exam_id = ex.id AND er.enrollment_id = :enrollmentId
          ) THEN 'published'
          WHEN ex.start_date > CURRENT_DATE THEN 'upcoming'
          ELSE 'awaiting'
        END AS student_status
      FROM exams ex
      WHERE ex.session_id = :sessionId
        AND ex.class_id = :classId
      ORDER BY ex.start_date DESC, ex.id DESC;
    `, {
      replacements: {
        enrollmentId: context.enrollmentId,
        sessionId: context.sessionId,
        classId: context.classId,
      },
    });
    res.ok({ exams: rows, is_withheld: isWithheld, total_pending: feeSummary.total_pending }, `${rows.length} exam(s) found.`);
  } catch (err) { next(err); }
};

exports.resultByExam = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    await ensureAchievementsFresh(context);

    // Fee check
    const feeSummary = await getFeeSummary(context);
    const [[sr]] = await sequelize.query(`
      SELECT release_result FROM student_results WHERE enrollment_id = :enrollmentId LIMIT 1;
    `, { replacements: { enrollmentId: context.enrollmentId } });
    
    const isWithheld = feeSummary.total_pending > 0 && !sr?.release_result;

    if (isWithheld) {
      return res.fail(`Result withheld due to pending fees of ${feeSummary.total_pending}. Please clear dues to view marks.`, [], 403);
    }

    const examId = Number(req.params.examId);
    const [[exam]] = await sequelize.query(`
      SELECT id, name, exam_type, start_date, end_date, status
      FROM exams
      WHERE id = :examId
        AND session_id = :sessionId
        AND class_id = :classId
      LIMIT 1;
    `, {
      replacements: {
        examId,
        sessionId: context.sessionId,
        classId: context.classId,
      },
    });

    if (!exam) {
      const [[exists]] = await sequelize.query(`SELECT id FROM exams WHERE id = :examId LIMIT 1;`, { replacements: { examId } });
      if (exists) {
        recordForbiddenAttempt(req, context.studentId, 'exam_access', { examId });
        return res.fail('You are not allowed to access this exam.', [], 403);
      }
      return res.fail('Exam not found.', [], 404);
    }

    const [rows] = await sequelize.query(`
      SELECT
        sub.id AS subject_id,
        sub.name AS subject_name,
        sub.code AS subject_code,
        sub.subject_type,
        sub.combined_total_marks AS total_marks,
        sub.combined_passing_marks AS passing_marks,
        sub.theory_total_marks,
        sub.theory_passing_marks,
        sub.practical_total_marks,
        sub.practical_passing_marks,
        sub.combined_total_marks,
        sub.combined_passing_marks,
        er.marks_obtained,
        er.theory_marks_obtained,
        er.practical_marks_obtained,
        er.is_absent,
        er.grade,
        er.is_pass
      FROM subjects sub
      LEFT JOIN exam_results er
        ON er.subject_id = sub.id
       AND er.exam_id = :examId
       AND er.enrollment_id = :enrollmentId
      WHERE sub.class_id = :classId
        AND sub.is_deleted = false
      ORDER BY sub.order_number ASC, sub.name ASC;
    `, {
      replacements: {
        examId,
        enrollmentId: context.enrollmentId,
        classId: context.classId,
      },
    });

    const subjects = rows.map((row) => {
      const total_obtained = row.is_absent
        ? null
        : Number(row.marks_obtained ?? (Number(row.theory_marks_obtained || 0) + Number(row.practical_marks_obtained || 0)));
      const max_marks = Number(row.combined_total_marks || row.total_marks || 0);
      const percentage = total_obtained == null || max_marks === 0 ? null : roundNumber((total_obtained / max_marks) * 100);
      return {
        ...row,
        total_obtained,
        percentage,
        status: row.is_absent ? 'absent' : row.is_pass ? 'pass' : 'fail',
        borderline: !row.is_absent && Number(total_obtained || 0) === Number(row.combined_passing_marks || row.passing_marks || -1),
      };
    });

    const totalObtained = subjects.filter((row) => row.total_obtained != null).reduce((sum, row) => sum + Number(row.total_obtained || 0), 0);
    const totalMax = subjects.reduce((sum, row) => sum + Number(row.combined_total_marks || row.total_marks || 0), 0);
    const overall = totalMax > 0 ? roundNumber((totalObtained / totalMax) * 100) : 0;
    const strengths = subjects.filter((row) => ['A', 'A+'].includes(row.grade)).map((row) => row.subject_name);
    const needsImprovement = subjects.filter((row) => ['D', 'F'].includes(row.grade) || row.status === 'fail').map((row) => row.subject_name);
    const failedSubjects = subjects.filter((row) => row.status === 'fail').map((row) => row.subject_name);

    let overallGrade = 'F';
    if (overall >= 90) overallGrade = 'A+';
    else if (overall >= 80) overallGrade = 'A';
    else if (overall >= 70) overallGrade = 'B';
    else if (overall >= 60) overallGrade = 'C';
    else if (overall >= 50) overallGrade = 'D';

    const result_status = failedSubjects.length === 0 ? 'pass' : failedSubjects.length <= 2 ? 'compartment' : 'fail';

    res.ok({
      exam,
      summary: { percentage: overall, grade: overallGrade, grade_color: gradeColor(overallGrade), result_status },
      subjects,
      analysis: { strengths, needs_improvement: needsImprovement },
      compartment: result_status === 'compartment' ? { subjects: failedSubjects } : null,
    }, 'Exam result loaded.');
  } catch (err) { next(err); }
};

exports.reportCard = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    await ensureAchievementsFresh(context);

    // Fee check
    const feeSummary = await getFeeSummary(context);
    const [[sr]] = await sequelize.query(`
      SELECT release_result FROM student_results WHERE enrollment_id = :enrollmentId LIMIT 1;
    `, { replacements: { enrollmentId: context.enrollmentId } });
    
    const isWithheld = feeSummary.total_pending > 0 && !sr?.release_result;

    if (isWithheld) {
      return res.fail(`Report card withheld due to pending fees of ${feeSummary.total_pending}. Please clear dues to download.`, [], 403);
    }

    const examId = Number(req.params.examId);
    const attendance = await getAttendanceSummary(context.enrollmentId);
    const sharedRemarks = await getSharedStudentRemarks(context.studentId, context.enrollmentId, { limit: 5 });
    const latestSharedRemark = sharedRemarks[0] || null;

    const [rows] = await sequelize.query(`
      SELECT
        sub.name AS subject_name,
        sub.combined_total_marks AS total_marks,
        sub.theory_total_marks,
        sub.practical_total_marks,
        sub.combined_total_marks,
        er.theory_marks_obtained,
        er.practical_marks_obtained,
        er.marks_obtained,
        er.grade
      FROM subjects sub
      LEFT JOIN exam_results er
        ON er.subject_id = sub.id
       AND er.exam_id = :examId
       AND er.enrollment_id = :enrollmentId
      WHERE sub.class_id = :classId
        AND sub.is_deleted = false
      ORDER BY sub.order_number ASC, sub.name ASC;
    `, {
      replacements: {
        examId,
        enrollmentId: context.enrollmentId,
        classId: context.classId,
      },
    });

    const totalObtained = rows.reduce((sum, row) => sum + Number(row.marks_obtained || row.theory_marks_obtained || 0) + Number(row.practical_marks_obtained || 0), 0);
    const totalMax = rows.reduce((sum, row) => sum + Number(row.combined_total_marks || row.total_marks || 0), 0);
    const percentage = totalMax > 0 ? roundNumber((totalObtained / totalMax) * 100) : 0;

    res.ok({
      school: { name: 'EduCore School', address: 'Main Campus' },
      session_name: context.student.session_name,
      student: {
        name: getStudentName(context.student),
        admission_no: context.student.admission_no,
        class_name: context.student.class_name,
        section_name: context.student.section_name,
        roll_number: context.student.roll_number,
        date_of_birth: context.student.date_of_birth,
        photo_path: context.student.photo_path,
      },
      attendance,
      marks: rows,
      totals: { obtained: totalObtained, maximum: totalMax, percentage },
      result: percentage >= 50 ? 'pass' : 'fail',
      remarks: {
        teacher: latestSharedRemark?.remark_text || null,
        teacher_name: latestSharedRemark?.teacher_name || null,
        class_teacher_name: context.student.class_teacher_name,
        items: sharedRemarks,
      },
    }, 'Report card data loaded.');
  } catch (err) { next(err); }
};

exports.fees = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const [rows] = await sequelize.query(`
      SELECT
        fi.id,
        fs.name AS fee_type_name,
        fs.frequency AS period,
        fi.amount_due,
        fi.amount_paid,
        fi.late_fee_amount,
        fi.concession_amount,
        fi.due_date,
        fi.paid_date,
        fi.status,
        fi.carry_from_invoice_id,
        ROUND(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid, 2) AS balance_remaining,
        (
          SELECT status
          FROM upi_payment_requests
          WHERE invoice_id = fi.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS upi_latest_status,
        (
          SELECT rejected_reason
          FROM upi_payment_requests
          WHERE invoice_id = fi.id AND status = 'rejected'
          ORDER BY created_at DESC
          LIMIT 1
        ) AS upi_rejected_reason,
        (
          SELECT created_at
          FROM upi_payment_requests
          WHERE invoice_id = fi.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS upi_submitted_at
        FROM fee_invoices fi      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE fi.enrollment_id = :enrollmentId
      ORDER BY fi.due_date ASC, fi.id DESC;
    `, { replacements: { enrollmentId: context.enrollmentId } });
    const summary = await getFeeSummary(context);
    res.ok({ 
      invoices: rows, 
      summary, 
      school_upi: context.school.upi_id,
      school_name: context.school.name
    }, 'Fee data loaded.');
  } catch (err) { next(err); }
};

exports.getSchoolUpi = async (req, res, next) => {
  try {
    const [[school]] = await sequelize.query(`
      SELECT upi_id, COALESCE(upi_name, name) AS school_name, upi_enabled
      FROM schools
      WHERE id = :schoolId
      LIMIT 1;
    `, { replacements: { schoolId: req.user.school_id } });

    if (!school) return res.fail('School not found.', [], 404);
    res.ok(school);
  } catch (err) { next(err); }
};

exports.createUpiPaymentRequest = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const { invoice_id, amount, upi_transaction_id, student_note } = req.body;

    // Check if UPI payments are enabled for this school
    const [[schoolStatus]] = await sequelize.query(`
      SELECT upi_enabled FROM schools WHERE id = :schoolId LIMIT 1;
    `, { replacements: { schoolId: req.user.school_id } });

    if (schoolStatus && !schoolStatus.upi_enabled) {
      return res.fail('UPI payments are currently disabled for maintenance. Please try again later.', [], 503);
    }

    if (!invoice_id || !amount) {
      return res.fail('invoice_id and amount are required.', [], 422);
    }

    // Ensure invoice belongs to student
    const owned = await ensureOwnedInvoice(req, context, invoice_id);
    if (!owned) return res.fail('Invoice not found or access denied.', [], 403);

    // Check for duplicate pending request
    const [[existing]] = await sequelize.query(`
      SELECT id FROM upi_payment_requests
      WHERE invoice_id = :invoiceId AND status = 'pending'
      LIMIT 1;
    `, { replacements: { invoiceId: invoice_id } });

    if (existing) {
      return res.fail('A pending UPI payment request already exists for this invoice.', [], 409);
    }

    // Check for duplicate transaction ID (if provided and not placeholder)
    if (upi_transaction_id && upi_transaction_id !== 'PAYMENT_PENDING') {
      const [[txExists]] = await sequelize.query(`
        SELECT id FROM upi_payment_requests
        WHERE upi_transaction_id = :upiTxId AND status IN ('pending', 'confirmed')
        LIMIT 1;
      `, { replacements: { upiTxId: upi_transaction_id } });

      if (txExists) {
        return res.fail('This UPI Transaction ID has already been submitted and is currently being processed or has been confirmed.', [], 409);
      }
    }

    const [[request]] = await sequelize.query(`
      INSERT INTO upi_payment_requests (
        enrollment_id, invoice_id, amount, upi_transaction_id, student_note, status, created_at, updated_at
      )
      VALUES (
        :enrollmentId, :invoiceId, :amount, :upiTxId, :note, 'pending', NOW(), NOW()
      )
      RETURNING id, status, created_at;
    `, {
      replacements: {
        enrollmentId: context.enrollmentId,
        invoiceId: invoice_id,
        amount,
        upiTxId: upi_transaction_id,
        note: student_note || null,
      },
    });

    res.ok(request, 'UPI payment request submitted successfully.', 201);

    // Notify admins and accountants
    try {
      const studentName = getStudentName(context.student);
      const [admins] = await sequelize.query(`
        SELECT id FROM users 
        WHERE school_id = :schoolId AND role IN ('admin', 'accountant') AND is_active = true;
      `, { replacements: { schoolId: req.user.school_id } });

      const notificationPromises = admins.map(admin => sendNotification({
        userId: admin.id,
        title: 'New UPI Payment Request',
        content: `${studentName} has submitted a UPI payment request of ₹${amount}.`,
        type: 'fee_payment',
        data: { requestId: request.id, invoiceId: invoice_id }
      }));
      await Promise.all(notificationPromises);
    } catch (notifyErr) {
      logger.error('[UPI-Notification-Error] Failed to notify staff:', notifyErr);
    }
  } catch (err) { next(err); }
};

exports.getUpiPaymentRequests = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const [requests] = await sequelize.query(`
      SELECT upr.*, fs.name AS fee_name, fi.due_date
      FROM upi_payment_requests upr
      JOIN fee_invoices fi ON fi.id = upr.invoice_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE upr.enrollment_id = :enrollmentId
      ORDER BY upr.created_at DESC;
    `, { replacements: { enrollmentId: context.enrollmentId } });

    res.ok({ requests });
  } catch (err) { next(err); }
};

exports.feeSummary = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const summary = await getFeeSummary(context);
    res.ok(summary, 'Fee summary loaded.');
  } catch (err) { next(err); }
};

exports.feeInvoiceDetail = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const invoiceId = Number(req.params.invoiceId);
    const owned = await ensureOwnedInvoice(req, context, invoiceId);
    if (!owned) return res.fail('Invoice not found.', [], 404);

    const [[invoice]] = await sequelize.query(`
      SELECT
        fi.id,
        fs.name AS fee_type_name,
        fs.frequency AS period,
        fi.amount_due AS original_amount,
        fi.amount_paid,
        fi.late_fee_amount,
        fi.concession_amount,
        fi.concession_reason,
        fi.due_date,
        fi.paid_date,
        fi.status,
        fi.carry_from_invoice_id,
        ROUND(fi.amount_due + fi.late_fee_amount - fi.concession_amount, 2) AS total_payable,
        ROUND(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid, 2) AS balance_remaining
      FROM fee_invoices fi
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE fi.id = :invoiceId
      LIMIT 1;
    `, { replacements: { invoiceId } });

    const [payments] = await sequelize.query(`
      SELECT id, payment_date, amount, payment_mode, transaction_ref AS receipt_no
      FROM fee_payments
      WHERE invoice_id = :invoiceId
      ORDER BY payment_date DESC, id DESC;
    `, { replacements: { invoiceId } });

    res.ok({ ...invoice, payments }, 'Invoice detail loaded.');
  } catch (err) { next(err); }
};

exports.feePayments = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const [payments] = await sequelize.query(`
      SELECT
        fp.id,
        fp.payment_date,
        fp.amount,
        fp.payment_mode,
        fp.transaction_ref AS receipt_no,
        fs.name AS fee_type_name,
        fi.id AS invoice_id
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE fi.enrollment_id = :enrollmentId
      ORDER BY fp.payment_date DESC, fp.id DESC;
    `, { replacements: { enrollmentId: context.enrollmentId } });
    res.ok({ payments }, `${payments.length} payment(s) found.`);
  } catch (err) { next(err); }
};

exports.feeReceipt = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const paymentId = Number(req.params.paymentId);
    const [[receipt]] = await sequelize.query(`
      SELECT
        fp.id,
        fp.payment_date,
        fp.amount,
        fp.payment_mode,
        fp.transaction_ref AS receipt_no,
        fs.name AS fee_type_name,
        fi.id AS invoice_id,
        fi.enrollment_id,
        ROUND(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid, 2) AS balance_after
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE fp.id = :paymentId
      LIMIT 1;
    `, { replacements: { paymentId } });

    if (!receipt) return res.fail('Receipt not found.', [], 404);
    if (Number(receipt.enrollment_id) !== Number(context.enrollmentId)) {
      recordForbiddenAttempt(req, context.studentId, 'receipt_access', { paymentId });
      return res.fail('You are not allowed to access this receipt.', [], 403);
    }
    res.ok(receipt, 'Receipt data loaded.');
  } catch (err) { next(err); }
};

exports.timetable = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const [rows] = await sequelize.query(`
      SELECT
        ts.id,
        ts.day_of_week,
        ts.period_number,
        ts.start_time,
        ts.end_time,
        ts.room_number,
        sub.name AS subject_name,
        sub.code AS subject_code,
        CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name
      FROM timetable_slots ts
      JOIN subjects sub ON sub.id = ts.subject_id
      JOIN teachers teacher ON teacher.id = ts.teacher_id
      JOIN teacher_assignments ta
        ON ta.session_id = ts.session_id
       AND ta.class_id = ts.class_id
       AND ta.section_id = ts.section_id
       AND ta.teacher_id = ts.teacher_id
       AND ta.subject_id = ts.subject_id
       AND ta.is_active = true
      WHERE ts.session_id = :sessionId
        AND ts.class_id = :classId
        AND ts.section_id = :sectionId
        AND ts.is_active = true
      ORDER BY
        ARRAY_POSITION(ARRAY['monday','tuesday','wednesday','thursday','friday','saturday'], ts.day_of_week::text),
        ts.period_number ASC;
    `, {
      replacements: {
        sessionId: context.sessionId,
        classId: context.classId,
        sectionId: context.sectionId,
      },
    });
    res.ok({ timetable: rows }, `${rows.length} timetable slot(s) found.`);
  } catch (err) { next(err); }
};

exports.timetableToday = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const schedule = await getTodaySchedule(context);
    res.ok({ schedule }, `${schedule.length} slot(s) found for today.`);
  } catch (err) { next(err); }
};

exports.timetableCurrentPeriod = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const schedule = await getTodaySchedule(context);
    res.ok({
      current_period: schedule.find((item) => item.status === 'current') || null,
      next_period: schedule.find((item) => item.status === 'upcoming') || null,
    }, 'Current period status loaded.');
  } catch (err) { next(err); }
};

exports.timetableExamSchedule = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const [rows] = await sequelize.query(`
      SELECT 
        ex.id AS exam_id,
        ex.name AS exam_name,
        ex.exam_type,
        ex.start_date AS exam_start_date,
        ex.end_date AS exam_end_date,
        ex.status,
        es.id AS exam_subject_id,
        es.exam_date,
        es.start_time,
        es.end_time,
        sub.name AS subject_name,
        sub.code AS subject_code,
        NULLIF(CONCAT(t.first_name, ' ', t.last_name), ' ') AS invigilator_name
      FROM exams ex
      LEFT JOIN exam_subjects es ON es.exam_id = ex.id
      LEFT JOIN subjects sub ON sub.id = es.subject_id
      LEFT JOIN teachers t ON t.id = es.invigilator_teacher_id
      WHERE ex.session_id = :sessionId
        AND ex.class_id = :classId
        AND ex.status IN ('published', 'upcoming', 'ongoing', 'completed')
      ORDER BY ex.start_date ASC, es.exam_date ASC, es.start_time ASC;
    `, {
      replacements: {
        sessionId: context.sessionId,
        classId: context.classId,
      },
    });

    const exams = [];
    const examMap = new Map();

    rows.forEach(row => {
      if (!examMap.has(row.exam_id)) {
        const examObj = {
          id: row.exam_id,
          name: row.exam_name,
          exam_type: row.exam_type,
          start_date: row.exam_start_date,
          end_date: row.exam_end_date,
          status: row.status,
          days_remaining: Math.max(
            Math.ceil((new Date(`${row.exam_start_date}T00:00:00`).getTime() - new Date(`${todayDate()}T00:00:00`).getTime()) / 86400000),
            0
          ),
          timetable: []
        };
        examMap.set(row.exam_id, examObj);
        exams.push(examObj);
      }
      
      if (row.exam_subject_id) {
        examMap.get(row.exam_id).timetable.push({
          id: row.exam_subject_id,
          exam_date: row.exam_date,
          start_time: row.start_time,
          end_time: row.end_time,
          subject_name: row.subject_name,
          subject_code: row.subject_code,
          invigilator_name: row.invigilator_name
        });
      }
    });

    res.ok({ exams }, `${exams.length} exam schedule item(s) found.`);
  } catch (err) { next(err); }
};

exports.homeworkList = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const statusFilter = req.query.status || null;
    const subjectFilter = req.query.subject || null;
    const [rows] = await sequelize.query(`
      SELECT
        h.id,
        h.title,
        h.description,
        h.due_date,
        h.submission_type,
        h.max_marks,
        h.attachment_path,
        h.created_at,
        sub.id AS subject_id,
        sub.name AS subject_name,
        CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name,
        hs.id AS submission_id,
        hs.submitted_at,
        hs.marks_obtained,
        hs.teacher_comment,
        hs.status AS submission_status,
        hs.is_late
      FROM homework h
      JOIN subjects sub ON sub.id = h.subject_id
      JOIN teachers teacher ON teacher.id = h.teacher_id
      LEFT JOIN homework_submissions hs
        ON hs.homework_id = h.id
       AND hs.enrollment_id = :enrollmentId
      WHERE h.session_id = :sessionId
        AND h.class_id = :classId
        AND h.section_id = :sectionId
        AND h.status = 'active'
        AND (:subjectFilter::int IS NULL OR h.subject_id = :subjectFilter)
      ORDER BY h.due_date ASC, h.id DESC;
    `, {
      replacements: {
        enrollmentId: context.enrollmentId,
        sessionId: context.sessionId,
        classId: context.classId,
        sectionId: context.sectionId,
        subjectFilter,
      },
    });

    const homework = await Promise.all(rows.map(async (row) => {
      const hasRealSubmission = row.submission_status && row.submission_status !== 'pending';
      let student_status = hasRealSubmission ? row.submission_status : 'pending';
      if (!hasRealSubmission && String(row.due_date) < todayDate()) student_status = 'overdue';
      if (!hasRealSubmission && String(row.due_date) === todayDate()) student_status = 'due_today';

      let is_online = false;
      if (redis.status === 'ready' && row.teacher_id) {
        const key = `online:${req.user.school_id}:teacher:${row.teacher_id}`;
        const val = await redis.get(key);
        is_online = val === '1';
      }

      return {
        ...row,
        submission_id: hasRealSubmission ? row.submission_id : null,
        submitted_at: hasRealSubmission ? row.submitted_at : null,
        marks_obtained: hasRealSubmission ? row.marks_obtained : null,
        teacher_comment: hasRealSubmission ? row.teacher_comment : null,
        submission_status: hasRealSubmission ? row.submission_status : null,
        is_late: hasRealSubmission ? row.is_late : false,
        student_status,
        is_online,
      };
    }));
    
    const filteredHomework = homework.filter((row) => !statusFilter || statusFilter === 'all' || row.student_status === statusFilter);

    res.ok({ homework: filteredHomework }, `${filteredHomework.length} homework item(s) found.`);
  } catch (err) { next(err); }
};

exports.homeworkDetail = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const homeworkId = Number(req.params.id);
    const owned = await ensureOwnedHomework(req, context, homeworkId);
    if (!owned) return res.fail('Homework not found.', [], 404);

    const [[detail]] = await sequelize.query(`
      SELECT
        h.id,
        h.title,
        h.description,
        h.due_date,
        h.submission_type,
        h.max_marks,
        h.attachment_path,
        h.created_at,
        sub.name AS subject_name,
        CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name,
        hs.id AS submission_id,
        hs.submitted_at,
        hs.submission_content,
        hs.attachment_path AS submission_attachment_path,
        hs.marks_obtained,
        hs.teacher_comment,
        hs.status AS submission_status,
        hs.is_late
      FROM homework h
      JOIN subjects sub ON sub.id = h.subject_id
      JOIN teachers teacher ON teacher.id = h.teacher_id
      LEFT JOIN homework_submissions hs
        ON hs.homework_id = h.id
       AND hs.enrollment_id = :enrollmentId
      WHERE h.id = :homeworkId
      LIMIT 1;
    `, {
      replacements: {
        homeworkId,
        enrollmentId: context.enrollmentId,
      },
    });
    const hasRealSubmission = detail?.submission_status && detail.submission_status !== 'pending';
    const student_status = hasRealSubmission
      ? detail.submission_status
      : String(detail?.due_date) < todayDate()
        ? 'overdue'
        : String(detail?.due_date) === todayDate()
          ? 'due_today'
          : 'pending';

    res.ok({
      ...detail,
      submission_id: hasRealSubmission ? detail.submission_id : null,
      submitted_at: hasRealSubmission ? detail.submitted_at : null,
      submission_content: hasRealSubmission ? detail.submission_content : null,
      submission_attachment_path: hasRealSubmission ? detail.submission_attachment_path : null,
      marks_obtained: hasRealSubmission ? detail.marks_obtained : null,
      teacher_comment: hasRealSubmission ? detail.teacher_comment : null,
      submission_status: hasRealSubmission ? detail.submission_status : null,
      is_late: hasRealSubmission ? detail.is_late : false,
      student_status,
    }, 'Homework detail loaded.');
  } catch (err) { next(err); }
};

exports.homeworkSubmit = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const homeworkId = Number(req.params.id);
    const owned = await ensureOwnedHomework(req, context, homeworkId);
    if (!owned) return res.fail('Homework not found.', [], 404);

    const [[homework]] = await sequelize.query(`SELECT id, due_date, submission_type FROM homework WHERE id = :homeworkId LIMIT 1;`, { replacements: { homeworkId } });
    if (!['online', 'both'].includes(homework.submission_type)) {
      return res.fail('This homework must be submitted physically to the teacher.', [], 422);
    }

    const submission_content = req.body.submission_content || null;
    const attachment_path = req.body.attachment_path || null;
    if (!submission_content && !attachment_path) {
      return res.fail('Provide submission content or an attachment to submit homework.', [], 422);
    }

    const [[saved]] = await sequelize.query(`
      INSERT INTO homework_submissions (
        homework_id, enrollment_id, submitted_at, submission_content, attachment_path,
        marks_obtained, teacher_comment, is_late, status, created_at
      )
      VALUES (
        :homeworkId, :enrollmentId, NOW(), :submissionContent, :attachmentPath,
        NULL, NULL, :isLate, 'submitted', NOW()
      )
      ON CONFLICT (homework_id, enrollment_id)
      DO UPDATE SET
        submitted_at = NOW(),
        submission_content = EXCLUDED.submission_content,
        attachment_path = EXCLUDED.attachment_path,
        is_late = EXCLUDED.is_late,
        status = CASE WHEN homework_submissions.status = 'graded' THEN homework_submissions.status ELSE 'submitted' END
      RETURNING id, submitted_at, status, is_late;
    `, {
      replacements: {
        homeworkId,
        enrollmentId: context.enrollmentId,
        submissionContent: submission_content,
        attachmentPath: attachment_path,
        isLate: String(homework.due_date) < todayDate(),
      },
    });
    await ensureAchievementsFresh(context);
    res.ok(saved, 'Homework submitted successfully.', 201);
  } catch (err) { next(err); }
};

exports.homeworkSubmissions = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const [rows] = await sequelize.query(`
      SELECT
        hs.id,
        h.id AS homework_id,
        h.title,
        h.due_date,
        sub.name AS subject_name,
        hs.submitted_at,
        hs.status,
        hs.marks_obtained,
        hs.teacher_comment
      FROM homework_submissions hs
      JOIN homework h ON h.id = hs.homework_id
      JOIN subjects sub ON sub.id = h.subject_id
      WHERE hs.enrollment_id = :enrollmentId
        AND hs.status IN ('submitted', 'graded')
      ORDER BY hs.created_at DESC, hs.id DESC;
    `, { replacements: { enrollmentId: context.enrollmentId } });
    res.ok({ submissions: rows }, `${rows.length} submission(s) found.`);
  } catch (err) { next(err); }
};

exports.noticeList = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const category = req.query.category || null;
    const [rows] = await sequelize.query(`
      SELECT
        n.id,
        n.title,
        n.content,
        n.category,
        n.publish_date,
        n.expiry_date,
        n.target_scope,
        n.teacher_id,
        COALESCE(NULLIF(TRIM(CONCAT(poster.first_name, ' ', poster.last_name)), ''), admin.name, 'School') AS posted_by,
        COALESCE(n.created_by_role, 'teacher') AS posted_by_role,
        COALESCE(NULLIF(TRIM(CONCAT(poster.first_name, ' ', poster.last_name)), ''), admin.name, 'School') AS teacher_name,
        COALESCE(n.created_by_role, 'teacher') AS teacher_role,
        COALESCE(snr.read_at IS NOT NULL, false) AS is_read,
        COALESCE(np.pinned_at IS NOT NULL, false) AS is_pinned
      FROM teacher_notices n
      LEFT JOIN teachers poster ON poster.id = n.teacher_id
      LEFT JOIN users admin ON admin.id = n.created_by_user_id
      LEFT JOIN student_notice_reads snr
        ON snr.notice_id = n.id
       AND snr.student_id = :studentId
      LEFT JOIN notice_pins np
        ON np.notice_id = n.id
       AND np.student_id = :studentId
      WHERE n.is_active = true
        AND (n.expiry_date IS NULL OR n.expiry_date >= NOW())
        AND (:category::text IS NULL OR n.category = :category)
        AND (
          n.target_scope = 'all_students'
          OR n.target_scope = 'whole_school'
          OR (n.target_scope = 'specific_student' AND n.target_student_id = :studentId)
          OR (n.target_scope IN ('my_class_only', 'whole_class') AND n.class_id = :classId AND n.section_id = :sectionId)
          OR (n.target_scope = 'specific_section' AND n.class_id = :classId AND (n.section_id IS NULL OR n.section_id = :sectionId))
          OR (n.target_scope = 'specific_subject' AND EXISTS (
            SELECT 1 FROM student_subjects ss
            WHERE ss.student_id = :studentId
              AND ss.subject_id = n.subject_id
              AND ss.is_active = true
          ))
        )      ORDER BY
        COALESCE(np.pinned_at IS NOT NULL, false) DESC,
        COALESCE(snr.read_at IS NOT NULL, false) ASC,
        n.publish_date DESC;
    `, {
      replacements: {
        studentId: context.studentId,
        classId: context.classId,
        sectionId: context.sectionId,
        category,
      },
    });
    const notices = await Promise.all(rows.map(async (row) => {
      let is_online = false;
      if (redis.status === 'ready' && row.teacher_role === 'teacher' && row.teacher_id) {
        const key = `online:${req.user.school_id}:teacher:${row.teacher_id}`;
        const val = await redis.get(key);
        is_online = val === '1';
      }
      return { ...row, is_online };
    }));

    res.ok({ notices, unread_count: notices.filter((row) => !row.is_read).length }, `${notices.length} notice(s) found.`);
  } catch (err) { next(err); }
};

exports.noticeRead = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const noticeId = Number(req.params.id);
    const owned = await ensureOwnedNotice(req, context, noticeId);
    if (!owned) return res.fail('Notice not found.', [], 404);

    await sequelize.query(`
      INSERT INTO student_notice_reads (notice_id, student_id, read_at)
      VALUES (:noticeId, :studentId, NOW())
      ON CONFLICT (notice_id, student_id)
      DO UPDATE SET read_at = NOW();
    `, {
      replacements: {
        noticeId,
        studentId: context.studentId,
      },
    });
    res.ok({ notice_id: noticeId }, 'Notice marked as read.');
  } catch (err) { next(err); }
};

exports.noticePin = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const noticeId = Number(req.params.id);
    const owned = await ensureOwnedNotice(req, context, noticeId);
    if (!owned) return res.fail('Notice not found.', [], 404);

    await sequelize.query(`
      INSERT INTO notice_pins (notice_id, student_id, pinned_at)
      VALUES (:noticeId, :studentId, NOW())
      ON CONFLICT (notice_id, student_id)
      DO UPDATE SET pinned_at = NOW();
    `, {
      replacements: {
        noticeId,
        studentId: context.studentId,
      },
    });
    res.ok({ notice_id: noticeId }, 'Notice pinned.');
  } catch (err) { next(err); }
};

exports.noticeUnpin = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const noticeId = Number(req.params.id);
    const owned = await ensureOwnedNotice(req, context, noticeId);
    if (!owned) return res.fail('Notice not found.', [], 404);

    await sequelize.query(`
      DELETE FROM notice_pins
      WHERE notice_id = :noticeId
        AND student_id = :studentId;
    `, {
      replacements: {
        noticeId,
        studentId: context.studentId,
      },
    });
    res.ok({ notice_id: noticeId }, 'Notice unpinned.');
  } catch (err) { next(err); }
};

exports.profile = async (req, res, next) => {
  try {
    const context = await getStudentContext(req, { requireEnrollment: false });
    const achievements = await ensureAchievementsFresh(context);
    const sharedRemarks = await getSharedStudentRemarks(context.studentId, context.enrollmentId, { limit: 10 });
    res.ok({
      profile: {
        id: context.student.id,
        admission_no: context.student.admission_no,
        first_name: context.student.first_name,
        last_name: context.student.last_name,
        full_name: getStudentName(context.student),
        date_of_birth: context.student.date_of_birth,
        gender: context.student.gender,
        photo_path: context.student.photo_path,
        blood_group: context.student.blood_group,
        medical_notes: context.student.medical_notes,
        phone: context.student.phone,
        email: context.student.email,
        address: context.student.address,
        city: context.student.city,
        state: context.student.state,
        pincode: context.student.pincode,
        father_name: context.student.father_name,
        father_phone: context.student.father_phone,
        father_occupation: context.student.father_occupation,
        mother_name: context.student.mother_name,
        mother_phone: context.student.mother_phone,
        mother_email: context.student.mother_email,
        emergency_contact: context.student.emergency_contact,
        class_name: context.student.class_name,
        section_name: context.student.section_name,
        roll_number: context.student.roll_number,
        session_name: context.student.session_name,
        class_teacher_name: context.student.class_teacher_name,
        joined_date: context.student.joined_date,
        joining_type: context.student.joining_type,
      },
      shared_remarks: sharedRemarks,
      achievements,
    }, 'Student profile loaded.');
  } catch (err) { next(err); }
};

exports.academicHistory = async (req, res, next) => {
  try {
    const context = await getStudentContext(req, { requireEnrollment: false });
    const [rows] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        sess.name AS session_name,
        cls.name AS class_name,
        sec.name AS section_name,
        e.roll_number,
        e.status AS enrollment_status,
        e.joined_date,
        e.left_date,
        sr.result,
        sr.percentage,
        sr.grade,
        sr.is_promoted,
        ROUND(
          (
            COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))
            + COUNT(a.id) FILTER (WHERE a.status = 'half_day') * 0.5
          ) / NULLIF(COUNT(a.id) FILTER (WHERE a.status <> 'holiday'), 0) * 100,
          2
        ) AS attendance_percentage
      FROM enrollments e
      JOIN sessions sess ON sess.id = e.session_id
      JOIN classes cls ON cls.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN student_results sr ON sr.enrollment_id = e.id
      LEFT JOIN attendance a ON a.enrollment_id = e.id
      WHERE e.student_id = :studentId
      GROUP BY
        e.id, sess.name, cls.name, sec.name, e.roll_number, e.status, e.joined_date, e.left_date,
        sr.result, sr.percentage, sr.grade, sr.is_promoted, sess.start_date
      ORDER BY sess.start_date ASC, e.id ASC;
    `, { replacements: { studentId: context.studentId } });

    res.ok({
      history: rows,
      timeline: rows.map((row) => ({
        session_name: row.session_name,
        class_name: row.class_name,
        section_name: row.section_name,
        result: row.result,
        attendance_percentage: Number(row.attendance_percentage || 0),
        promoted: row.is_promoted,
      })),
      performance_trend: rows.map((row) => ({
        session_name: row.session_name,
        percentage: Number(row.percentage || 0),
      })),
    }, 'Academic history loaded.');
  } catch (err) { next(err); }
};

exports.correctionRequestCreate = async (req, res, next) => {
  try {
    const context = await getStudentContext(req, { requireEnrollment: false });
    const { field_name, current_value = null, requested_value, reason, supporting_document_path = null } = req.body;
    if (!field_name || !requested_value || !reason) {
      return res.fail('field_name, requested_value, and reason are required.', [], 422);
    }

    const [[requestRow]] = await sequelize.query(`
      INSERT INTO student_correction_requests (
        student_id, field_name, current_value, requested_value, reason,
        supporting_document_path, status, reviewed_by, admin_response, reviewed_at, created_at, updated_at
      )
      VALUES (
        :studentId, :fieldName, :currentValue, :requestedValue, :reason,
        :documentPath, 'pending', NULL, NULL, NULL, NOW(), NOW()
      )
      RETURNING id, field_name, current_value, requested_value, reason, supporting_document_path, status, created_at;
    `, {
      replacements: {
        studentId: context.studentId,
        fieldName: field_name,
        currentValue: current_value,
        requestedValue: requested_value,
        reason,
        documentPath: supporting_document_path,
      },
    });
    res.ok({ request: requestRow }, 'Correction request submitted.', 201);
  } catch (err) { next(err); }
};

exports.correctionRequestList = async (req, res, next) => {
  try {
    const context = await getStudentContext(req, { requireEnrollment: false });
    const [rows] = await sequelize.query(`
      SELECT
        id,
        field_name,
        current_value,
        requested_value,
        reason,
        supporting_document_path,
        status,
        admin_response,
        created_at,
        reviewed_at
      FROM student_correction_requests
      WHERE student_id = :studentId
      ORDER BY created_at DESC, id DESC;
    `, { replacements: { studentId: context.studentId } });
    res.ok({ requests: rows }, `${rows.length} correction request(s) found.`);
  } catch (err) { next(err); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const context = await getStudentContext(req, { requireEnrollment: false });
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.fail('current_password and new_password are required.', [], 422);
    }

    const [[studentAuth]] = await sequelize.query(`
      SELECT id, password_hash
      FROM students
      WHERE id = :studentId
      LIMIT 1;
    `, { replacements: { studentId: context.studentId } });

    if (!studentAuth?.password_hash) {
      return res.fail('Student portal password is not configured for this account yet.', [], 422);
    }

    const valid = await bcrypt.compare(current_password, studentAuth.password_hash);
    if (!valid) return res.fail('Current password is incorrect.', [], 401);

    const hash = await bcrypt.hash(new_password, 12);
    await sequelize.query(`
      UPDATE students
      SET password_hash = :hash,
          last_password_change = NOW(),
          updated_at = NOW()
      WHERE id = :studentId;
    `, {
      replacements: {
        hash,
        studentId: context.studentId,
      },
    });
    res.ok({}, 'Password changed successfully.');
  } catch (err) { next(err); }
};

exports.achievements = async (req, res, next) => {
  try {
    const context = await getStudentContext(req, { requireEnrollment: false });
    const achievements = await ensureAchievementsFresh(context);
    res.ok({ achievements }, `${achievements.length} achievement(s) found.`);
  } catch (err) { next(err); }
};

exports.materials = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const subjectId = req.query.subject_id || null;
    const [rows] = await sequelize.query(`
      SELECT
        sm.id,
        sm.title,
        sm.description,
        sm.file_path,
        sm.file_type,
        sm.file_size,
        sm.created_at,
        sub.name AS subject_name,
        teacher.id AS teacher_id,
        CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name,
        COALESCE(MAX(mv.viewed_at), NULL) AS last_viewed_at
      FROM study_materials sm
      JOIN subjects sub ON sub.id = sm.subject_id
      JOIN teachers teacher ON teacher.id = sm.teacher_id
      LEFT JOIN material_views mv
        ON mv.material_id = sm.id
       AND mv.student_id = :studentId
      WHERE sm.session_id = :sessionId
        AND sm.class_id = :classId
        AND sm.is_active = true
        AND (:subjectId::int IS NULL OR sm.subject_id = :subjectId)
      GROUP BY sm.id, sub.name, teacher.id, teacher.first_name, teacher.last_name
      ORDER BY sm.created_at DESC, sm.id DESC;
    `, {
      replacements: {
        studentId: context.studentId,
        sessionId: context.sessionId,
        classId: context.classId,
        subjectId,
      },
    });

    const materials = await Promise.all(rows.map(async (row) => {
      let is_online = false;
      if (redis.status === 'ready' && row.teacher_id) {
        const key = `online:${req.user.school_id}:teacher:${row.teacher_id}`;
        const val = await redis.get(key);
        is_online = val === '1';
      }
      return { ...row, is_online };
    }));

    res.ok({ materials }, `${materials.length} study material(s) found.`);
  } catch (err) { next(err); }
};

exports.materialDetail = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const materialId = Number(req.params.id);
    const owned = await ensureOwnedMaterial(req, context, materialId);
    if (!owned) return res.fail('Study material not found.', [], 404);

    const [[material]] = await sequelize.query(`
      SELECT
        sm.id,
        sm.title,
        sm.description,
        sm.file_path,
        sm.file_type,
        sm.file_size,
        sm.created_at,
        sub.name AS subject_name,
        CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name
      FROM study_materials sm
      JOIN subjects sub ON sub.id = sm.subject_id
      JOIN teachers teacher ON teacher.id = sm.teacher_id
      WHERE sm.id = :materialId
      LIMIT 1;
    `, { replacements: { materialId } });

    await sequelize.query(`
      INSERT INTO material_views (material_id, student_id, viewed_at, created_at, updated_at)
      VALUES (:materialId, :studentId, NOW(), NOW(), NOW());
    `, {
      replacements: {
        materialId,
        studentId: context.studentId,
      },
    });
    res.ok(material, 'Study material detail loaded.');
  } catch (err) { next(err); }
};

exports.attendanceExport = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const { from_date, to_date } = req.query;
    
    // Default to current year if no dates provided
    const now = new Date();
    const from = from_date || `${now.getFullYear()}-01-01`;
    const to = to_date || now.toISOString().slice(0, 10);

    const [[school]] = await sequelize.query(`
      SELECT name, address, phone 
      FROM schools 
      WHERE id = :schoolId 
      LIMIT 1
    `, { replacements: { schoolId: req.user.school_id } });

    const [records] = await sequelize.query(`
      SELECT date, status, override_reason
      FROM attendance
      WHERE enrollment_id = :enrollmentId
        AND date BETWEEN :from AND :to
      ORDER BY date DESC;
    `, { 
      replacements: { 
        enrollmentId: context.enrollmentId,
        from,
        to
      } 
    });

    if (!records || records.length === 0) {
      return res.fail('No attendance records found for the selected period.', [], 404);
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Attendance_Report_${context.student.first_name}.pdf"`);
    doc.pipe(res);

    // Header
    doc.rect(0, 0, 595, 100).fill('#7C3AED');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(20).text(school.name.toUpperCase(), 40, 25);
    doc.font('Helvetica').fontSize(10).text(`${school.address || ''} | Phone: ${school.phone || ''}`, 40, 50);
    doc.font('Helvetica-Bold').fontSize(14).text('STUDENT ATTENDANCE REPORT', 40, 70);
    doc.fontSize(8).text(`Generated: ${new Date().toLocaleString()}`, 400, 25, { align: 'right', width: 155 });

    doc.y = 120;

    // Student Details
    doc.fillColor('#F8FAFC').rect(40, 110, 515, 80).fill().stroke('#E2E8F0');
    doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(14).text(getStudentName(context.student), 60, 125);
    doc.font('Helvetica').fontSize(10).text(`Admission No: ${context.student.admission_no}`, 60, 145);
    doc.text(`Class: ${context.student.class_name} (${context.student.section_name}) | Roll: ${context.student.roll_number || 'N/A'}`, 60, 160);
    doc.text(`Period: ${from} to ${to}`, 60, 175);

    // Stats
    const summary = await getAttendanceSummary(context.enrollmentId);
    const pct = parseFloat(summary.percentage || 0);
    
    doc.fillColor('#7C3AED').rect(400, 120, 140, 60).fill();
    doc.fillColor('white').font('Helvetica-Bold').fontSize(18).text(`${pct.toFixed(1)}%`, 400, 135, { width: 140, align: 'center' });
    doc.fontSize(9).text('Overall Attendance', 400, 155, { width: 140, align: 'center' });

    doc.y = 210;
    doc.fillColor('#7C3AED').font('Helvetica-Bold').fontSize(12).text('Attendance History', 40, doc.y);
    doc.moveDown(0.5);

    // Table Headers
    const colWidths = [120, 120, 275];
    const headers = ['Date', 'Status', 'Remarks'];
    
    doc.fillColor('#F1F5F9').rect(40, doc.y, 515, 20).fill();
    doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(10);
    let hx = 40;
    headers.forEach((h, i) => {
      doc.text(h, hx + 10, doc.y + 5, { width: colWidths[i] - 10 });
      hx += colWidths[i];
    });
    doc.y += 20;

    // Table Rows
    records.forEach((record, index) => {
      if (doc.y > 750) {
        doc.addPage();
        // Re-draw mini header on new page
        doc.rect(0, 0, 595, 40).fill('#7C3AED');
        doc.fillColor('white').font('Helvetica-Bold').fontSize(12).text('Attendance History (Continued)', 40, 15);
        doc.y = 60;
      }

      const rowY = doc.y;
      if (index % 2 === 1) doc.fillColor('#F8FAFC').rect(40, rowY, 515, 20).fill();
      
      doc.fillColor('#1E293B').font('Helvetica').fontSize(10);
      let rx = 40;
      
      const formattedDate = new Date(record.date).toLocaleDateString('en-GB', { 
        day: '2-digit', month: 'short', year: 'numeric' 
      });
      
      doc.text(formattedDate, rx + 10, rowY + 5); rx += colWidths[0];
      
      let statusColor = '#16A34A'; // present
      if (record.status === 'absent') statusColor = '#EF4444';
      else if (record.status === 'late' || record.status === 'half_day') statusColor = '#D97706';
      
      doc.fillColor(statusColor).font('Helvetica-Bold').text(record.status.toUpperCase(), rx + 10, rowY + 5); 
      rx += colWidths[1];
      
      doc.fillColor('#64748B').font('Helvetica').text(record.override_reason || record.remarks || '-', rx + 10, rowY + 5, { width: colWidths[2] - 10 });
      
      doc.y = rowY + 20;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#94A3B8').fontSize(8).text(`Page ${i + 1} of ${range.count}`, 40, 800, { align: 'center', width: 515 });
    }

    doc.end();
  } catch (err) { 
    next(err); 
  }
};

exports.resultsExport = async (req, res, next) => {
  try {
    const context = await getStudentContext(req);
    const examId = Number(req.params.examId);
    
    // Fee check
    const feeSummary = await getFeeSummary(context);
    const [[sr]] = await sequelize.query(`
      SELECT release_result FROM student_results WHERE enrollment_id = :enrollmentId LIMIT 1;
    `, { replacements: { enrollmentId: context.enrollmentId } });
    
    const isWithheld = feeSummary.total_pending > 0 && !sr?.release_result;

    if (isWithheld) {
      return res.fail(`Result withheld due to pending fees of ${feeSummary.total_pending}.`, [], 403);
    }

    const [[exam]] = await sequelize.query(`
      SELECT id, name, exam_type, start_date, end_date, status
      FROM exams
      WHERE id = :examId
      LIMIT 1;
    `, { replacements: { examId } });

    if (!exam) return res.fail('Exam not found.', [], 404);

    const [[school]] = await sequelize.query(`
      SELECT name, address, phone 
      FROM schools 
      WHERE id = :schoolId 
      LIMIT 1
    `, { replacements: { schoolId: req.user.school_id } });

    const [rows] = await sequelize.query(`
      SELECT
        sub.name AS subject_name,
        sub.combined_total_marks AS total_marks,
        er.marks_obtained,
        er.grade,
        er.is_pass
      FROM subjects sub
      JOIN exam_results er ON er.subject_id = sub.id
      WHERE er.exam_id = :examId
        AND er.enrollment_id = :enrollmentId
      ORDER BY sub.name ASC;
    `, {
      replacements: {
        examId,
        enrollmentId: context.enrollmentId
      }
    });

    if (!rows || rows.length === 0) {
      return res.fail('No result records found for this exam.', [], 404);
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Result_${exam.name}_${context.student.first_name}.pdf"`);
    doc.pipe(res);

    // Header
    doc.rect(0, 0, 595, 100).fill('#1E40AF');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(20).text(school.name.toUpperCase(), 40, 25);
    doc.font('Helvetica').fontSize(10).text(`${school.address || ''} | Phone: ${school.phone || ''}`, 40, 50);
    doc.font('Helvetica-Bold').fontSize(14).text('EXAMINATION REPORT CARD', 40, 70);
    doc.fontSize(8).text(`Generated: ${new Date().toLocaleString()}`, 400, 25, { align: 'right', width: 155 });

    doc.y = 120;

    // Student & Exam Details
    doc.fillColor('#F8FAFC').rect(40, 110, 515, 80).fill().stroke('#E2E8F0');
    doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(14).text(getStudentName(context.student), 60, 125);
    doc.font('Helvetica').fontSize(10).text(`Admission No: ${context.student.admission_no} | Roll: ${context.student.roll_number || 'N/A'}`, 60, 145);
    doc.text(`Class: ${context.student.class_name} (${context.student.section_name})`, 60, 160);
    doc.font('Helvetica-Bold').text(`Exam: ${exam.name} (${exam.exam_type})`, 60, 175);

    const totalObtained = rows.reduce((sum, row) => sum + Number(row.marks_obtained || 0), 0);
    const totalMax = rows.reduce((sum, row) => sum + Number(row.total_marks || 0), 0);
    const percentage = totalMax > 0 ? ((totalObtained / totalMax) * 100).toFixed(1) : '0.0';

    doc.fillColor('#1E40AF').rect(400, 120, 140, 60).fill();
    doc.fillColor('white').font('Helvetica-Bold').fontSize(18).text(`${percentage}%`, 400, 135, { width: 140, align: 'center' });
    doc.fontSize(9).text('Final Percentage', 400, 155, { width: 140, align: 'center' });

    doc.y = 210;
    doc.fillColor('#1E40AF').font('Helvetica-Bold').fontSize(12).text('Subject Wise Marks', 40, doc.y);
    doc.moveDown(0.5);

    // Table Headers
    const colWidths = [200, 100, 100, 115];
    const headers = ['Subject', 'Max Marks', 'Obtained', 'Grade'];
    
    doc.fillColor('#EFF6FF').rect(40, doc.y, 515, 20).fill();
    doc.fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(10);
    let hx = 40;
    headers.forEach((h, i) => {
      doc.text(h, hx + 10, doc.y + 5, { width: colWidths[i] - 10 });
      hx += colWidths[i];
    });
    doc.y += 20;

    // Table Rows
    rows.forEach((row, index) => {
      const rowY = doc.y;
      if (index % 2 === 1) doc.fillColor('#F8FAFC').rect(40, rowY, 515, 20).fill();
      
      doc.fillColor('#1E293B').font('Helvetica').fontSize(10);
      let rx = 40;
      doc.text(row.subject_name, rx + 10, rowY + 5); rx += colWidths[0];
      doc.text(String(row.total_marks), rx + 10, rowY + 5); rx += colWidths[1];
      
      const obt = row.marks_obtained ?? 'ABS';
      const isPass = row.is_pass !== false;
      doc.fillColor(isPass ? '#1E293B' : '#EF4444').font(isPass ? 'Helvetica' : 'Helvetica-Bold').text(String(obt), rx + 10, rowY + 5); 
      rx += colWidths[2];
      
      doc.fillColor('#1E293B').font('Helvetica-Bold').text(row.grade || '-', rx + 10, rowY + 5);
      
      doc.y = rowY + 20;
    });

    // Summary at bottom
    doc.moveDown(1);
    doc.strokeColor('#E2E8F0').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(11).text(`Grand Total: ${totalObtained} / ${totalMax}`, 40, doc.y, { align: 'right', width: 515 });

    doc.end();
  } catch (err) { next(err); }
};
