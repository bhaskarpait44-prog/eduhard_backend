'use strict';

const XLSX = require('xlsx');
const sequelize = require('../config/database');
const examEngine = require('../utils/examEngine');
const computeSubjectMarks = require('../utils/computeSubjectMarks');

const toNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toStringOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  return String(value);
};

function normalizeExamSubjectConfig(subject, input = {}) {
  const subject_type = input.subject_type || subject.subject_type || 'theory';
  const normalized = {
    subject_id: Number(subject.id),
    subject_type,
    theory_total_marks: toNumberOrNull(input.theory_total_marks ?? subject.theory_total_marks),
    theory_passing_marks: toNumberOrNull(input.theory_passing_marks ?? subject.theory_passing_marks),
    practical_total_marks: toNumberOrNull(input.practical_total_marks ?? subject.practical_total_marks),
    practical_passing_marks: toNumberOrNull(input.practical_passing_marks ?? subject.practical_passing_marks),
    assigned_teacher_id: input.assigned_teacher_id ? Number(input.assigned_teacher_id) : null,
    exam_date: toStringOrNull(input.exam_date),
    start_time: toStringOrNull(input.start_time),
    end_time: toStringOrNull(input.end_time),
    invigilator_teacher_id: input.invigilator_teacher_id ? Number(input.invigilator_teacher_id) : null,
  };

  if (!['theory', 'practical', 'both'].includes(subject_type)) {
    const error = new Error('subject_type must be one of theory, practical, or both.');
    error.status = 422;
    throw error;
  }

  if (subject_type === 'theory') {
    if (normalized.theory_total_marks == null || normalized.theory_passing_marks == null) {
      const error = new Error(`${subject.name}: theory total and passing marks are required.`);
      error.status = 422;
      throw error;
    }
    if (normalized.theory_passing_marks >= normalized.theory_total_marks) {
      const error = new Error(`${subject.name}: theory passing marks must be less than theory total marks.`);
      error.status = 422;
      throw error;
    }
  }

  if (subject_type === 'practical') {
    if (normalized.practical_total_marks == null || normalized.practical_passing_marks == null) {
      const error = new Error(`${subject.name}: practical total and passing marks are required.`);
      error.status = 422;
      throw error;
    }
    if (normalized.practical_passing_marks >= normalized.practical_total_marks) {
      const error = new Error(`${subject.name}: practical passing marks must be less than practical total marks.`);
      error.status = 422;
      throw error;
    }
  }

  if (subject_type === 'both') {
    if (
      normalized.theory_total_marks == null ||
      normalized.theory_passing_marks == null ||
      normalized.practical_total_marks == null ||
      normalized.practical_passing_marks == null
    ) {
      const error = new Error(`${subject.name}: both theory and practical marks are required.`);
      error.status = 422;
      throw error;
    }
    if (normalized.theory_passing_marks >= normalized.theory_total_marks) {
      const error = new Error(`${subject.name}: theory passing marks must be less than theory total marks.`);
      error.status = 422;
      throw error;
    }
    if (normalized.practical_passing_marks >= normalized.practical_total_marks) {
      const error = new Error(`${subject.name}: practical passing marks must be less than practical total marks.`);
      error.status = 422;
      throw error;
    }
  }

  if ((normalized.start_time && !normalized.end_time) || (!normalized.start_time && normalized.end_time)) {
    const error = new Error(`${subject.name}: both start and end time are required for timetable setup.`);
    error.status = 422;
    throw error;
  }

  if (normalized.start_time && normalized.end_time && normalized.end_time <= normalized.start_time) {
    const error = new Error(`${subject.name}: end time must be after start time.`);
    error.status = 422;
    throw error;
  }

  return {
    ...normalized,
    ...computeSubjectMarks(normalized),
  };
}

// GET /api/exams - List exams with optional session_id filter
exports.list = async (req, res, next) => {
  try {
    const { session_id } = req.query;
    let sql = `
      SELECT e.*,
        c.name as class_name,
        c.stream as class_stream,
        s.name as session_name,
        COUNT(es.id) AS subject_count,
        SUM(CASE WHEN es.review_status = 'submitted' THEN 1 ELSE 0 END) AS pending_review_count,
        SUM(CASE WHEN es.review_status = 'approved' THEN 1 ELSE 0 END) AS approved_subject_count
      FROM exams e
      JOIN classes c ON c.id = e.class_id
      JOIN sessions s ON s.id = e.session_id
      LEFT JOIN exam_subjects es ON es.exam_id = e.id
      WHERE e.session_id IN (
        SELECT id FROM sessions WHERE school_id = :schoolId
      )
    `;
    const replacements = { schoolId: req.user.school_id };

    if (session_id) {
      sql += ' AND e.session_id = :sessionId';
      replacements.sessionId = session_id;
    }

    sql += ' GROUP BY e.id, c.id, c.name, c.stream, s.name ORDER BY e.start_date DESC, e.id DESC';

    const [exams] = await sequelize.query(sql, { 
      replacements: { 
        ...replacements, 
        sessionId: session_id ? Number(session_id) : undefined 
      } 
    });
    res.ok({ exams });
  } catch (err) { next(err); }
};

// GET /api/exams/:id/subjects - Get subjects for exam's class
exports.getSubjects = async (req, res, next) => {
  try {
    const examId = req.params.id;

    const [[exam]] = await sequelize.query(`
      SELECT e.id, e.class_id, e.session_id, e.status, e.published_at, 
             c.name AS class_name, c.stream AS class_stream
      FROM exams e
      JOIN classes c ON c.id = e.class_id
      WHERE e.id = :examId
      LIMIT 1;
    `, { replacements: { examId: Number(examId) } });

    if (!exam) return res.fail('Exam not found', [], 404);

    const [subjects] = await sequelize.query(`
      SELECT
        es.id,
        es.exam_id,
        es.subject_id,
        s.name,
        s.code,
        s.order_number,
        es.subject_type,
        es.theory_total_marks,
        es.theory_passing_marks,
        es.practical_total_marks,
        es.practical_passing_marks,
        es.combined_total_marks,
        es.combined_passing_marks,
        es.assigned_teacher_id,
        CONCAT(teacher.first_name, ' ', teacher.last_name) AS assigned_teacher_name,
        es.exam_date,
        es.start_time,
        es.end_time,
        es.invigilator_teacher_id,
        CONCAT(invigilator.first_name, ' ', invigilator.last_name) AS invigilator_teacher_name,
        es.review_status,
        es.submitted_by,
        submitter.name AS submitted_by_name,
        es.submitted_at,
        es.reviewed_by,
        reviewer.name AS reviewed_by_name,
        es.reviewed_at,
        es.review_note,
        SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) AS total_students,
        COUNT(er.id) AS entered_students,
        SUM(CASE WHEN er.is_absent = true THEN 1 ELSE 0 END) AS absent_students,
        COALESCE(ROUND(AVG(CASE WHEN er.is_absent = false THEN er.marks_obtained END), 2), 0) AS average_marks,
        COALESCE(MAX(CASE WHEN er.is_absent = false THEN er.marks_obtained END), 0) AS highest_marks,
        COALESCE(MIN(CASE WHEN er.is_absent = false THEN er.marks_obtained END), 0) AS lowest_marks
      FROM exam_subjects es
      JOIN subjects s ON s.id = es.subject_id
      LEFT JOIN teachers teacher ON teacher.id = es.assigned_teacher_id
      LEFT JOIN teachers invigilator ON invigilator.id = es.invigilator_teacher_id
      LEFT JOIN users submitter ON submitter.id = es.submitted_by
      LEFT JOIN users reviewer ON reviewer.id = es.reviewed_by
      LEFT JOIN enrollments e
        ON e.session_id = :sessionId
       AND e.class_id = :classId
       AND e.status = 'active'
      LEFT JOIN exam_results er
        ON er.exam_id = es.exam_id
       AND er.subject_id = es.subject_id
       AND er.enrollment_id = e.id
      WHERE es.exam_id = :examId
      GROUP BY
        es.id,
        es.exam_id,
        es.subject_id,
        s.name,
        s.code,
        s.order_number,
        teacher.first_name,
        teacher.last_name,
        invigilator.first_name,
        invigilator.last_name,
        submitter.name,
        reviewer.name
      ORDER BY s.order_number, s.name;
    `, {
      replacements: {
        examId: Number(examId),
        sessionId: Number(exam.session_id),
        classId: Number(exam.class_id),
      },
    });

    const [entries] = await sequelize.query(`
      SELECT
        es.subject_id,
        e.id AS enrollment_id,
        e.roll_number,
        stu.admission_no,
        stu.first_name,
        stu.last_name,
        er.id AS result_id,
        er.marks_obtained,
        er.theory_marks_obtained,
        er.practical_marks_obtained,
        er.is_absent,
        er.grade,
        er.is_pass,
        er.entered_by,
        entered_by_user.name AS entered_by_name,
        er.override_by,
        override_by_user.name AS override_by_name,
        er.override_reason,
        er.updated_at
      FROM exam_subjects es
      JOIN enrollments e
        ON e.session_id = :sessionId
       AND e.class_id = :classId
       AND e.status = 'active'
      JOIN students stu ON stu.id = e.student_id
      LEFT JOIN exam_results er
        ON er.exam_id = es.exam_id
       AND er.subject_id = es.subject_id
       AND er.enrollment_id = e.id
      LEFT JOIN users entered_by_user ON entered_by_user.id = er.entered_by
      LEFT JOIN users override_by_user ON override_by_user.id = er.override_by
      WHERE es.exam_id = :examId
      ORDER BY
        es.subject_id,
        e.roll_number,
        stu.first_name,
        stu.last_name;
    `, {
      replacements: {
        examId: Number(examId),
        sessionId: Number(exam.session_id),
        classId: Number(exam.class_id),
      },
    });

    const studentsBySubject = entries.reduce((acc, row) => {
      const key = Number(row.subject_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});

    const reviewSummary = subjects.reduce((summary, row) => {
      summary.total_subjects += 1;
      summary.total_students += Number(row.total_students || 0);
      summary.total_entered_students += Number(row.entered_students || 0);

      if (row.review_status === 'approved') summary.approved_count += 1;
      else if (row.review_status === 'submitted') summary.submitted_count += 1;
      else if (row.review_status === 'rejected') summary.rejected_count += 1;
      else summary.draft_count += 1;

      return summary;
    }, {
      total_subjects: 0,
      approved_count: 0,
      submitted_count: 0,
      rejected_count: 0,
      draft_count: 0,
      total_students: 0,
      total_entered_students: 0,
    });

    res.ok({
      exam,
      review_summary: reviewSummary,
      subjects: subjects.map((row) => ({
        ...row,
        student_marks: studentsBySubject[Number(row.subject_id)] || [],
      })),
    });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const {
      class_id,
      name,
      exam_type,
      start_date,
      end_date,
      status = 'draft',
      subjects = [],
    } = req.body;

    const [[session]] = await sequelize.query(`
      SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
    `, { replacements: { schoolId: req.user.school_id } });

    if (!session) return res.fail('No active session. Activate a session first.');

    if (new Date(end_date) < new Date(start_date)) {
      return res.fail('end_date must be on or after start_date.');
    }

    if (!['draft', 'published'].includes(status)) {
      return res.fail('status must be draft or published.', [], 422);
    }

    if (!Array.isArray(subjects) || subjects.length === 0) {
      return res.fail('At least one subject must be selected for the exam.', [], 422);
    }

    const [subjectRows] = await sequelize.query(`
      SELECT id, class_id, name, code, subject_type,
             theory_total_marks, theory_passing_marks,
             practical_total_marks, practical_passing_marks
      FROM subjects
      WHERE class_id = :classId
        AND is_deleted = false
        AND id IN (:subjectIds);
    `, {
      replacements: {
        classId: class_id,
        subjectIds: subjects.map((item) => Number(item.subject_id)).filter(Boolean),
      },
    });

    if (subjectRows.length !== subjects.length) {
      return res.fail('One or more selected subjects do not belong to this class.', [], 422);
    }

    const subjectMap = new Map(subjectRows.map((row) => [Number(row.id), row]));
    const normalizedSubjects = subjects.map((item) => {
      const subject = subjectMap.get(Number(item.subject_id));
      if (!subject) {
        const error = new Error('One or more selected subjects do not belong to this class.');
        error.status = 422;
        throw error;
      }
      return normalizeExamSubjectConfig(subject, item);
    });

    const total_marks = normalizedSubjects.reduce((sum, item) => sum + Number(item.combined_total_marks || 0), 0);
    const passing_marks = normalizedSubjects.reduce((sum, item) => sum + Number(item.combined_passing_marks || 0), 0);
    const invigilatorIds = [...new Set(normalizedSubjects.map((item) => item.invigilator_teacher_id).filter(Boolean))];

    if (invigilatorIds.length > 0) {
      const [invigilators] = await sequelize.query(`
        SELECT id
        FROM teachers
        WHERE school_id = :schoolId
          AND is_deleted = false
          AND is_active = true
          AND id IN (:ids);
      `, {
        replacements: {
          schoolId: req.user.school_id,
          ids: invigilatorIds,
        },
      });

      if (invigilators.length !== invigilatorIds.length) {
        return res.fail('One or more selected invigilators are invalid.', [], 422);
      }
    }

    const exam = await sequelize.transaction(async (transaction) => {
      const [[createdExam]] = await sequelize.query(`
        INSERT INTO exams (
          session_id, class_id, name, exam_type, start_date, end_date,
          total_marks, passing_marks, status, published_at, published_by,
          created_by, updated_by, created_at, updated_at
        )
        VALUES (
          :session_id, :class_id, :name, :exam_type, :start_date, :end_date,
          :total_marks, :passing_marks, :status,
          CASE WHEN :status = 'published' THEN NOW() ELSE NULL END,
          CASE WHEN :status = 'published' THEN :userId ELSE NULL END,
          :userId, :userId, NOW(), NOW()
        )
        RETURNING id, session_id, class_id, name, exam_type, start_date, end_date, total_marks, passing_marks, status, published_at;
      `, {
        replacements: {
          session_id: session.id,
          class_id,
          name,
          exam_type,
          start_date,
          end_date,
          total_marks,
          passing_marks,
          status,
          userId: req.user.id,
        },
        transaction,
      });

      await sequelize.getQueryInterface().bulkInsert('exam_subjects', normalizedSubjects.map((item) => ({
        exam_id: createdExam.id,
        subject_id: item.subject_id,
        subject_type: item.subject_type,
        theory_total_marks: item.theory_total_marks,
        theory_passing_marks: item.theory_passing_marks,
        practical_total_marks: item.practical_total_marks,
        practical_passing_marks: item.practical_passing_marks,
        combined_total_marks: item.combined_total_marks,
        combined_passing_marks: item.combined_passing_marks,
        assigned_teacher_id: item.assigned_teacher_id,
        exam_date: item.exam_date,
        start_time: item.start_time,
        end_time: item.end_time,
        invigilator_teacher_id: item.invigilator_teacher_id,
        review_status: status === 'published' ? 'approved' : 'draft',
        reviewed_by: status === 'published' ? req.user.id : null,
        reviewed_at: status === 'published' ? new Date() : null,
        created_by: req.user.id,
        updated_by: req.user.id,
        created_at: new Date(),
        updated_at: new Date(),
      })), { transaction });

      return createdExam;
    });

    res.ok(exam, 'Exam created.', 201);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const [[exam]] = await sequelize.query(`
      SELECT e.id, e.status, e.session_id, e.class_id
      FROM exams e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.id = :id
        AND s.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!exam) return res.fail('Exam not found.', [], 404);
    if (!['draft', 'published'].includes(status)) {
      return res.fail('status must be draft or published.', [], 422);
    }

    if (status === 'published') {
      const [[reviewRow]] = await sequelize.query(`
        SELECT COUNT(*) AS pending_count
        FROM exam_subjects
        WHERE exam_id = :examId
          AND review_status IN ('submitted', 'rejected');
      `, { replacements: { examId: id } });

      if (Number(reviewRow?.pending_count || 0) > 0) {
        return res.fail('Approve all submitted subjects before publishing the exam.', [], 422);
      }

      const [[subjectRow]] = await sequelize.query(`
        SELECT COUNT(*) AS subject_count
        FROM exam_subjects
        WHERE exam_id = :examId;
      `, { replacements: { examId: id } });

      if (Number(subjectRow?.subject_count || 0) === 0) {
        return res.fail('Cannot publish an exam without subjects.', [], 422);
      }
    }

    await sequelize.query(`
      UPDATE exams
      SET status = :status,
          published_at = CASE WHEN :status = 'published' THEN NOW() ELSE NULL END,
          published_by = CASE WHEN :status = 'published' THEN :userId ELSE NULL END,
          updated_by = :userId,
          updated_at = NOW()
      WHERE id = :id;
    `, { replacements: { id, status, userId: req.user.id } });

    res.ok({ id: Number(id), status }, `Exam ${status === 'published' ? 'published' : 'moved back to draft'}.`);
  } catch (err) { next(err); }
};

exports.updateTimetable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subjects = [] } = req.body;

    if (!Array.isArray(subjects) || subjects.length === 0) {
      return res.fail('At least one timetable row is required.', [], 422);
    }

    const [[exam]] = await sequelize.query(`
      SELECT e.id, e.start_date, e.end_date
      FROM exams e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.id = :examId
        AND s.school_id = :schoolId
      LIMIT 1;
    `, {
      replacements: {
        examId: id,
        schoolId: req.user.school_id,
      },
    });

    if (!exam) return res.fail('Exam not found.', [], 404);

    const subjectIds = subjects.map((item) => Number(item.subject_id)).filter(Boolean);
    const uniqueSubjectIds = [...new Set(subjectIds)];
    if (uniqueSubjectIds.length !== subjects.length) {
      return res.fail('Each timetable row must reference one exam subject.', [], 422);
    }

    const [examSubjects] = await sequelize.query(`
      SELECT subject_id
      FROM exam_subjects
      WHERE exam_id = :examId
        AND subject_id IN (:subjectIds);
    `, {
      replacements: {
        examId: id,
        subjectIds: uniqueSubjectIds,
      },
    });

    if (examSubjects.length !== uniqueSubjectIds.length) {
      return res.fail('One or more subjects do not belong to this exam.', [], 422);
    }

    for (const item of subjects) {
      if ((item.start_time && !item.end_time) || (!item.start_time && item.end_time)) {
        return res.fail('Both start and end time are required when setting a timetable time.', [], 422);
      }

      if (item.start_time && item.end_time && String(item.end_time) <= String(item.start_time)) {
        return res.fail('End time must be after start time.', [], 422);
      }

      if (item.exam_date) {
        const date = String(item.exam_date);
        if (date < String(exam.start_date) || date > String(exam.end_date)) {
          return res.fail('Exam date must be within the exam start and end date.', [], 422);
        }
      }
    }

    const invigilatorIds = [...new Set(subjects
      .map((item) => item.invigilator_teacher_id ? Number(item.invigilator_teacher_id) : null)
      .filter(Boolean))];
    const markerIds = [...new Set(subjects
      .map((item) => item.assigned_teacher_id ? Number(item.assigned_teacher_id) : null)
      .filter(Boolean))];
    
    const allTeacherIds = [...new Set([...invigilatorIds, ...markerIds])];

    if (allTeacherIds.length > 0) {
      const [teachers] = await sequelize.query(`
        SELECT id
        FROM teachers
        WHERE school_id = :schoolId
          AND is_deleted = false
          AND is_active = true
          AND id IN (:ids);
      `, {
        replacements: {
          schoolId: req.user.school_id,
          ids: allTeacherIds,
        },
      });

      if (teachers.length !== allTeacherIds.length) {
        return res.fail('One or more selected teachers are invalid or inactive.', [], 422);
      }
    }

    await sequelize.transaction(async (transaction) => {
      for (const item of subjects) {
        await sequelize.query(`
          UPDATE exam_subjects
          SET exam_date = :examDate,
              start_time = :startTime,
              end_time = :endTime,
              invigilator_teacher_id = :invigilatorTeacherId,
              assigned_teacher_id = :assignedTeacherId,
              updated_by = :userId,
              updated_at = NOW()
          WHERE exam_id = :examId
            AND subject_id = :subjectId;
        `, {
          replacements: {
            examId: id,
            subjectId: Number(item.subject_id),
            examDate: item.exam_date || null,
            startTime: item.start_time || null,
            endTime: item.end_time || null,
            invigilatorTeacherId: item.invigilator_teacher_id ? Number(item.invigilator_teacher_id) : null,
            assignedTeacherId: item.assigned_teacher_id ? Number(item.assigned_teacher_id) : null,
            userId: req.user.id,
          },
          transaction,
        });
      }
    });

    res.ok({ updated_count: subjects.length }, 'Exam timetable saved.');
  } catch (err) { next(err); }
};

const { sendNotification } = require('../utils/notification');

exports.reviewSubject = async (req, res, next) => {
  try {
    const { id, subjectId } = req.params;
    const { review_status, review_note = null } = req.body;

    if (!['approved', 'rejected'].includes(review_status)) {
      return res.fail('review_status must be approved or rejected.', [], 422);
    }

    const [[row]] = await sequelize.query(`
      SELECT es.id, es.review_status, es.exam_id, es.subject_id, es.submitted_by, 
             ex.name AS exam_name, sub.name AS subject_name
      FROM exam_subjects es
      JOIN exams e ON e.id = es.exam_id
      JOIN sessions s ON s.id = e.session_id
      JOIN exams ex ON ex.id = es.exam_id
      JOIN subjects sub ON sub.id = es.subject_id
      WHERE es.exam_id = :examId
        AND es.subject_id = :subjectId
        AND s.school_id = :schoolId
      LIMIT 1;
    `, {
      replacements: {
        examId: id,
        subjectId,
        schoolId: req.user.school_id,
      },
    });

    if (!row) {
      return res.fail('Exam subject not found.', [], 404);
    }

    await sequelize.query(`
      UPDATE exam_subjects
      SET review_status = :reviewStatus,
          review_note = :reviewNote,
          reviewed_by = :userId,
          reviewed_at = NOW(),
          updated_by = :userId,
          updated_at = NOW()
      WHERE exam_id = :examId
        AND subject_id = :subjectId;
    `, {
      replacements: {
        examId: id,
        subjectId,
        reviewStatus: review_status,
        reviewNote: review_note,
        userId: req.user.id,
      },
    });

    // FCM Notification to the teacher who submitted
    if (row.submitted_by) {
      await sendNotification({
        teacherId: row.submitted_by,
        title: `Marks ${review_status === 'approved' ? 'Approved' : 'Rejected'}`,
        content: `Marks for ${row.subject_name} (${row.exam_name}) have been ${review_status}.${review_note ? ' Note: ' + review_note : ''}`,
        type: 'marks_status',
        data: { exam_id: row.exam_id, subject_id: row.subject_id, status: review_status }
      }).catch(err => console.error('FCM Error (Marks Review):', err));
    }

    res.ok({
      exam_id: Number(id),
      subject_id: Number(subjectId),
      review_status,
      review_note,
    }, `Subject ${review_status}.`);
  } catch (err) { next(err); }
};

exports.approveAllSubjects = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[exam]] = await sequelize.query(`
      SELECT e.id, e.name
      FROM exams e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.id = :examId
        AND s.school_id = :schoolId
      LIMIT 1;
    `, {
      replacements: {
        examId: id,
        schoolId: req.user.school_id,
      },
    });

    if (!exam) {
      return res.fail('Exam not found.', [], 404);
    }

    const [subjectsToNotify] = await sequelize.query(`
      SELECT es.subject_id, es.submitted_by, sub.name AS subject_name
      FROM exam_subjects es
      JOIN subjects sub ON sub.id = es.subject_id
      WHERE es.exam_id = :examId
        AND es.review_status = 'submitted';
    `, { replacements: { examId: id } });

    const [updatedRows] = await sequelize.query(`
      UPDATE exam_subjects
      SET review_status = 'approved',
          review_note = NULL,
          reviewed_by = :userId,
          reviewed_at = NOW(),
          updated_by = :userId,
          updated_at = NOW()
      WHERE exam_id = :examId
        AND review_status = 'submitted'
      RETURNING subject_id;
    `, {
      replacements: {
        examId: id,
        userId: req.user.id,
      },
    });

    // Notify teachers
    for (const sub of subjectsToNotify) {
      if (sub.submitted_by) {
        await sendNotification({
          teacherId: sub.submitted_by,
          title: `Marks Approved`,
          content: `Marks for ${sub.subject_name} (${exam.name}) have been approved.`,
          type: 'marks_status',
          data: { exam_id: id, subject_id: sub.subject_id, status: 'approved' }
        }).catch(err => console.error('FCM Error (Bulk Approve):', err));
      }
    }

    res.ok({
      exam_id: Number(id),
      approved_count: updatedRows.length,
      subject_ids: updatedRows.map((row) => Number(row.subject_id)),
    }, updatedRows.length > 0 ? 'All submitted subjects approved.' : 'No submitted subjects were pending approval.');
  } catch (err) { next(err); }
};

exports.getTemplate = async (req, res, next) => {
  try {
    const { id, subjectId } = req.params;

    const [[exam]] = await sequelize.query(`
      SELECT e.id, e.class_id, e.session_id, e.name AS exam_name, c.name AS class_name
      FROM exams e
      JOIN classes c ON c.id = e.class_id
      WHERE e.id = :id
      LIMIT 1;
    `, { replacements: { id } });

    if (!exam) return res.fail('Exam not found.', [], 404);

    const [[subject]] = await sequelize.query(`
      SELECT s.id, s.name, es.subject_type, es.theory_total_marks, es.practical_total_marks, es.combined_total_marks
      FROM exam_subjects es
      JOIN subjects s ON s.id = es.subject_id
      WHERE es.exam_id = :examId AND es.subject_id = :subjectId
      LIMIT 1;
    `, { replacements: { examId: id, subjectId } });

    if (!subject) return res.fail('Subject not configured for this exam.', [], 404);

    const [students] = await sequelize.query(`
      SELECT e.id AS enrollment_id, e.roll_number, s.admission_no, s.first_name, s.last_name
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId AND e.class_id = :classId AND e.status = 'active'
      ORDER BY e.roll_number, s.first_name;
    `, { replacements: { sessionId: exam.session_id, classId: exam.class_id } });

    const data = students.map(s => {
      const row = {
        'Enrollment ID': s.enrollment_id,
        'Admission No': s.admission_no,
        'Roll No': s.roll_number || '',
        'Student Name': `${s.first_name} ${s.last_name}`,
      };

      if (subject.subject_type === 'both') {
        row[`Theory Marks (Max ${subject.theory_total_marks})`] = '';
        row[`Practical Marks (Max ${subject.practical_total_marks})`] = '';
      } else {
        row[`Marks (Max ${subject.combined_total_marks})`] = '';
      }
      row['Is Absent (Yes/No)'] = 'No';
      return row;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Marks Entry');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=MarksTemplate_${exam.exam_name}_${subject.name}.xlsx`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  } catch (err) { next(err); }
};

exports.uploadMarks = async (req, res, next) => {
  try {
    const { id, subjectId } = req.params;
    if (!req.file) return res.fail('No file uploaded.');

    const [[exam]] = await sequelize.query(
      `SELECT e.id, e.status, e.class_id, e.session_id, s.school_id 
       FROM exams e 
       JOIN sessions s ON s.id = e.session_id
       WHERE e.id = :id;`,
      { replacements: { id } }
    );
    if (!exam) return res.fail('Exam not found.', [], 404);
    if (exam.status === 'completed') return res.fail('Exam is already completed.');

    const [[subject]] = await sequelize.query(`
      SELECT es.subject_id, es.subject_type, es.assigned_teacher_id
      FROM exam_subjects es
      WHERE es.exam_id = :examId AND es.subject_id = :subjectId
      LIMIT 1;
    `, { replacements: { examId: id, subjectId } });

    if (!subject) return res.fail('Subject not configured for this exam.', [], 404);

    // Security Check: Is this teacher assigned to this subject in the class?
    if (req.user.role === 'teacher') {
      const [[assignment]] = await sequelize.query(`
        SELECT id FROM teacher_assignments
        WHERE teacher_id = :teacherId
          AND session_id = :sessionId
          AND class_id = :classId
          AND subject_id = :subjectId
          AND is_active = true
        LIMIT 1;
      `, {
        replacements: {
          teacherId: req.user.id,
          sessionId: exam.session_id,
          classId: exam.class_id,
          subjectId: subjectId,
        }
      });

      if (!assignment) {
        return res.fail('You are not assigned to enter marks for this subject in any section of this class.', [], 403);
      }
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const gradingScale = await examEngine.getActiveGradingScale(exam.school_id);
    let processedCount = 0;

    await sequelize.transaction(async (t) => {
      for (const row of rows) {
        const enrollment_id = row['Enrollment ID'];
        if (!enrollment_id) continue;

        const isAbsent = String(row['Is Absent (Yes/No)'] || '').toLowerCase() === 'yes';
        const entry = {
          subject_id: Number(subjectId),
          is_absent: isAbsent,
        };

        if (!isAbsent) {
          if (subject.subject_type === 'both') {
            entry.theory_marks_obtained = row[Object.keys(row).find(k => k.startsWith('Theory Marks'))];
            entry.practical_marks_obtained = row[Object.keys(row).find(k => k.startsWith('Practical Marks'))];
          } else {
            entry.marks_obtained = row[Object.keys(row).find(k => k.startsWith('Marks'))];
          }
        }

        await examEngine.saveStudentMarks({
          exam,
          enrollment_id,
          results: [entry],
          userId: req.user.id,
          gradingScale,
          change_type: 'entry'
        }, t);

        processedCount++;
      }
    });

    res.ok({ processed: processedCount }, `Successfully uploaded marks for ${processedCount} students.`);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[exam]] = await sequelize.query(`
      SELECT e.id, e.name, e.session_id, e.class_id
      FROM exams e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.id = :id
        AND s.school_id = :schoolId
      LIMIT 1;
    `, {
      replacements: { id, schoolId: req.user.school_id },
    });

    if (!exam) return res.fail('Exam not found.', [], 404);

    const [[resultRow]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt
      FROM exam_results
      WHERE exam_id = :id;
    `, { replacements: { id } });

    if (Number(resultRow?.cnt || 0) > 0) {
      return res.fail('Cannot delete this exam because marks have already been entered.', [], 400);
    }

    await sequelize.query(`
      DELETE FROM exams
      WHERE id = :id;
    `, { replacements: { id } });

    res.ok({ id: Number(id) }, 'Exam deleted successfully.');
  } catch (err) { next(err); }
};
