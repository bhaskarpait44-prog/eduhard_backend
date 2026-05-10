'use strict';

const sequelize = require('../config/database');
const { Student, Subject, Enrollment } = require('../models');

// Assign subjects to a student during admission or later
exports.assignSubjects = async (req, res, next) => {
  try {
    const { student_id, session_id, subject_ids, is_core_filter } = req.body;

    if (!student_id || !session_id || !Array.isArray(subject_ids)) {
      return res.fail('student_id, session_id, and subject_ids array are required.', [], 422);
    }

    // Get student's current enrollment to find class
    const [[enrollment]] = await sequelize.query(`
      SELECT e.class_id, e.section_id
      FROM enrollments e
      WHERE e.student_id = :student_id
        AND e.session_id = :session_id
        AND e.status = 'active'
      LIMIT 1;
    `, { replacements: { student_id, session_id } });

    if (!enrollment) {
      return res.fail('No active enrollment found for this student in the specified session.', [], 404);
    }

    // Get subjects for this class, filter core if requested
    let subjectWhere = { class_id: enrollment.class_id, is_deleted: false };
    if (is_core_filter === true) {
      subjectWhere.is_core = true;
    }

    const subjects = await Subject.findAll({
      where: { ...subjectWhere, id: subject_ids },
    });

    if (subjects.length !== subject_ids.length) {
      return res.fail('One or more subjects not found for this class.', [], 404);
    }

    // Insert student_subjects (upsert - ignore duplicates)
    const values = subjects.map((s) => ({
      student_id,
      session_id,
      subject_id: s.id,
      is_core: s.is_core,
      created_by: req.user.id,
      updated_by: req.user.id,
    }));

    const now = new Date();
    await sequelize.getQueryInterface().bulkInsert(
      'student_subjects',
      values.map((row) => ({
        ...row,
        created_at: now,
        updated_at: now,
      })),
      { ignoreDuplicates: true }
    );

    const assigned = await sequelize.query(
      `SELECT ss.id, ss.subject_id, s.name AS subject_name, s.code, ss.is_core
       FROM student_subjects ss
       JOIN subjects s ON s.id = ss.subject_id
       WHERE ss.student_id = :student_id AND ss.session_id = :session_id AND ss.is_active = true
       ORDER BY s.order_number, s.id;`,
      { replacements: { student_id, session_id } }
    );

    res.ok(assigned[0], `${assigned[0].length} subject(s) assigned successfully.`);
  } catch (err) {
    next(err);
  }
};

// Get subjects assigned to a student
exports.getStudentSubjects = async (req, res, next) => {
  try {
    const { student_id, session_id } = req.params;

    const subjects = await sequelize.query(
      `SELECT ss.id, ss.subject_id, s.name AS subject_name, s.code, s.subject_type,
              s.is_core AS subject_is_core, ss.is_core AS assigned_is_core,
              s.theory_total_marks, s.practical_total_marks, s.combined_total_marks
       FROM student_subjects ss
       JOIN subjects s ON s.id = ss.subject_id
       WHERE ss.student_id = :student_id AND ss.session_id = :session_id AND ss.is_active = true
       ORDER BY s.order_number, s.id;`,
      { replacements: { student_id, session_id } }
    );

    res.ok(subjects[0]);
  } catch (err) {
    next(err);
  }
};

// Remove a subject from a student
exports.removeSubject = async (req, res, next) => {
  try {
    const { student_id, session_id, subject_id } = req.params;

    const [[result]] = await sequelize.query(
      `UPDATE student_subjects SET is_active = false, updated_at = NOW(), updated_by = :userId
       WHERE student_id = :student_id AND session_id = :session_id AND subject_id = :subject_id
       RETURNING id;`,
      { replacements: { student_id, session_id, subject_id, userId: req.user.id } }
    );

    if (!result) {
      return res.fail('Subject assignment not found.', [], 404);
    }

    res.ok({}, 'Subject removed from student.');
  } catch (err) {
    next(err);
  }
};

// Auto-assign core subjects for a student based on class
exports.autoAssignCoreSubjects = async (req, res, next) => {
  try {
    const { student_id, session_id } = req.body;

    if (!student_id || !session_id) {
      return res.fail('student_id and session_id are required.', [], 422);
    }

    const [[enrollment]] = await sequelize.query(`
      SELECT e.class_id
      FROM enrollments e
      WHERE e.student_id = :student_id
        AND e.session_id = :session_id
        AND e.status = 'active'
      LIMIT 1;
    `, { replacements: { student_id, session_id } });

    if (!enrollment) {
      return res.fail('No active enrollment found for this student in the specified session.', [], 404);
    }

    // Get all core subjects for this class
    const coreSubjects = await Subject.findAll({
      where: { class_id: enrollment.class_id, is_core: true, is_deleted: false },
    });

    if (coreSubjects.length === 0) {
      return res.ok([], 'No core subjects found for this class.');
    }

    const values = coreSubjects.map((s) => ({
      student_id,
      session_id,
      subject_id: s.id,
      is_core: true,
      created_by: req.user.id,
      updated_by: req.user.id,
    }));

    const now = new Date();
    await sequelize.getQueryInterface().bulkInsert(
      'student_subjects',
      values.map((row) => ({
        ...row,
        created_at: now,
        updated_at: now,
      })),
      { ignoreDuplicates: true }
    );

    const assigned = await sequelize.query(
      `SELECT ss.id, ss.subject_id, s.name AS subject_name, s.code, ss.is_core
       FROM student_subjects ss
       JOIN subjects s ON s.id = ss.subject_id
       WHERE ss.student_id = :student_id AND ss.session_id = :session_id AND ss.is_active = true
       ORDER BY s.order_number, s.id;`,
      { replacements: { student_id, session_id } }
    );

    res.ok(assigned[0], `${assigned[0].length} core subject(s) auto-assigned.`);
  } catch (err) {
    next(err);
  }
};
