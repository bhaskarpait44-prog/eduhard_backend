'use strict';

const sequelize = require('../config/database');

const TODAY = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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

async function getTeacherContext(req) {
  const session = await getCurrentSession(req.user.school_id);
  const assignments = await getTeacherAssignments(req.user.id, req.user.school_id, session?.id || null);
  const scope = buildScope(assignments);
  return { session, assignments, scope };
}

module.exports = {
  getCurrentSession,
  getTeacherAssignments,
  buildScope,
  getAccess,
  assertAccess,
  assertMarksAccess,
  assertAttendanceAccess,
  getTeacherContext,
};
