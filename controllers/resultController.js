'use strict';

const sequelize    = require('../config/database');
const examEngine   = require('../utils/examEngine');
const { MarkHistory, GradingScale } = require('../models');
const { invalidateCache } = require('../middlewares/cache');
const { writeAuditLog } = require('../utils/writeAuditLog');

async function getClassReviewSummary(sessionId, classId) {
  const [[row]] = await sequelize.query(`
    SELECT
      COUNT(es.id) AS total_subjects,
      SUM(CASE WHEN es.review_status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
      SUM(CASE WHEN es.review_status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
      SUM(CASE WHEN es.review_status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
      SUM(CASE WHEN es.review_status = 'draft' THEN 1 ELSE 0 END) AS draft_count
    FROM exams ex
    JOIN exam_subjects es ON es.exam_id = ex.id
    WHERE ex.session_id = :sessionId
      AND ex.class_id = :classId;
  `, {
    replacements: {
      sessionId,
      classId,
    },
  });

  return {
    total_subjects: Number(row?.total_subjects || 0),
    approved_count: Number(row?.approved_count || 0),
    submitted_count: Number(row?.submitted_count || 0),
    rejected_count: Number(row?.rejected_count || 0),
    draft_count: Number(row?.draft_count || 0),
  };
}

async function syncExamStatus(examId, transaction) {
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
    FROM exam_subjects
    WHERE exam_id = :examId;
  `, {
    replacements: { examId },
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

  const subjectCount = Number(subjectRow?.cnt || 0);
  const enrollmentCount = Number(enrollmentRow?.cnt || 0);
  const requiredEntries = subjectCount * enrollmentCount;

  const [[entryRow]] = await sequelize.query(`
    SELECT COUNT(*) AS cnt
    FROM exam_results
    WHERE exam_id = :examId;
  `, {
    replacements: { examId },
    transaction,
  });

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

exports.enterMarks = async (req, res, next) => {
  try {
    const { exam_id, enrollment_id, results } = req.body;

    const [[exam]] = await sequelize.query(
      `SELECT e.id, e.status, e.class_id, e.session_id, s.school_id, s.status AS session_status, s.is_locked AS session_locked
       FROM exams e 
       JOIN sessions s ON s.id = e.session_id
       WHERE e.id = :exam_id;`,
      { replacements: { exam_id } }
    );

    if (!exam) return res.fail('Exam not found.', [], 404);

    if (req.user.role === 'teacher' && exam.status === 'draft') {
      return res.fail('Teachers cannot enter marks for draft exams.', [], 403);
    }

    if (['closed', 'archived', 'locked'].includes(exam.session_status) || exam.session_locked) {
      return res.fail(`Cannot enter marks: session is ${exam.session_status}.`);
    }

    if (exam.status === 'completed') {
      return res.fail('Exam is already completed. Marks can no longer be edited.');
    }

    const [[enrollment]] = await sequelize.query(`
      SELECT id, class_id, session_id
      FROM enrollments
      WHERE id = :enrollmentId
      LIMIT 1;
    `, { replacements: { enrollmentId: enrollment_id } });

    if (!enrollment) {
      return res.fail('Enrollment not found.', [], 404);
    }

    if (Number(enrollment.class_id) !== Number(exam.class_id) || Number(enrollment.session_id) !== Number(exam.session_id)) {
      return res.fail('This enrollment does not belong to the selected exam class/session.', [], 422);
    }

    const gradingScale = await examEngine.getActiveGradingScale(exam.school_id);
    const saved = await examEngine.saveStudentMarks({
      exam,
      enrollment_id,
      results,
      userId: req.user.id,
      gradingScale
    });

    const examStatus = await syncExamStatus(exam_id);

    await writeAuditLog(sequelize, {
      tableName: 'exam_results',
      recordId: enrollment_id,
      changes: { field: 'bulk_entry', oldValue: 'none', newValue: `${results.length} subjects` },
      changedBy: req.user.id,
      reason: `Marks entered for exam: ${exam.id}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    invalidateCache(exam.school_id, '/api/results*');
    invalidateCache(exam.school_id, '/api/dashboard*');
    res.ok({ exam_id, enrollment_id, results: saved, exam_status: examStatus }, `${saved.length} subject result(s) saved.`);
  } catch (err) { next(err); }
};

const { generateReportCard } = require('../utils/pdfGenerator');
const { getPendingBalance } = require('../utils/feeManager');

exports.getResults = async (req, res, next) => {
  try {
    const { enrollment_id } = req.params;
    const schoolId = req.user.school_id;

    // 0. Verify Enrollment belongs to school
    const [[enrollmentCheck]] = await sequelize.query(`
      SELECT e.id FROM enrollments e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.id = :enrollment_id AND s.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { enrollment_id, schoolId } });

    if (!enrollmentCheck) {
      return res.fail('Enrollment not found or access denied.', [], 404);
    }

    // 1. Fetch Subject Wise Results
    const [subjectResults] = await sequelize.query(`
      SELECT 
        sub.id AS subject_id,
        sub.name AS subject_name,
        sub.code AS subject_code,
        er.marks_obtained,
        er.theory_marks_obtained,
        er.practical_marks_obtained,
        er.is_absent,
        er.grade,
        er.is_pass,
        es.theory_total_marks,
        es.practical_total_marks,
        es.combined_total_marks,
        e.name AS exam_name,
        e.exam_type,
        e.start_date
      FROM exam_results er
      JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id
      JOIN subjects sub ON sub.id = er.subject_id
      JOIN exams e ON e.id = er.exam_id
      WHERE er.enrollment_id = :enrollment_id
      ORDER BY e.start_date DESC, sub.order_number;
    `, { replacements: { enrollment_id } });

    // 2. Fetch Final Result Summary
    const [[finalResult]] = await sequelize.query(`
      SELECT 
        sr.*,
        sess.name AS session_name
      FROM student_results sr
      JOIN sessions sess ON sess.id = sr.session_id
      WHERE sr.enrollment_id = :enrollment_id
      LIMIT 1;
    `, { replacements: { enrollment_id } });

    // 3. Fee Check & Access Check (Withholding logic)
    const pendingBalance = await getPendingBalance(enrollment_id);
    const isUserRestricted = ['student', 'parent', 'teacher'].includes(req.user.role);
    const isWithheld = isUserRestricted
      ? (!finalResult || !finalResult.release_result)
      : (pendingBalance > 0 && !finalResult?.release_result);

    res.ok({
      subject_results: isWithheld ? [] : subjectResults,
      final_result: isWithheld ? null : (finalResult || null),
      is_withheld: isWithheld,
      pending_balance: pendingBalance,
      release_result: finalResult?.release_result || false
    });
  } catch (err) { next(err); }
};

exports.getReportCardData = async (req, res, next) => {
  try {
    const { enrollment_id } = req.params;
    const schoolId = req.user.school_id;

    // 0. Fetch Final Result
    const [[finalResult]] = await sequelize.query(`
      SELECT sr.release_result, sr.total_marks, sr.marks_obtained, sr.percentage, sr.grade, sr.result, sr.grace_marks_info
      FROM student_results sr
      JOIN sessions sess ON sess.id = sr.session_id
      WHERE sr.enrollment_id = :enrollment_id AND sess.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { enrollment_id, schoolId } });

    if (!finalResult) {
      return res.fail('Result not yet calculated for this student or access denied.', [], 400);
    }

    const isUserRestricted = ['student', 'parent', 'teacher'].includes(req.user.role);
    if (isUserRestricted && !finalResult.release_result) {
      return res.fail('Result not yet released or access denied.', [], 403);
    }

    // 1. Fetch Enrollment, Student, School, Session
    const [[data]] = await sequelize.query(`
      SELECT 
        e.id AS enrollment_id, e.roll_number, e.joined_date,
        s.id AS student_id, s.first_name, s.last_name, s.admission_no, 
        sp.father_name, sp.photo_path AS photo_url,
        c.name AS class_name,
        sec.name AS section_name,
        sess.id AS session_id, sess.name AS session_name,
        sch.id AS school_id, sch.name AS school_name, sch.address AS school_address, sch.phone AS school_phone, sch.email AS school_email, sch.logo_url, sch.principal_name
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      JOIN schools sch ON sch.id = s.school_id
      WHERE e.id = :enrollment_id AND sess.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { enrollment_id, schoolId } });

    if (!data) return res.fail('Enrollment not found.', [], 404);

    // 2. Fetch Subject Results
    const [subjectResults] = await sequelize.query(`
      SELECT 
        sub.name AS subject, sub.code,
        er.marks_obtained, er.theory_marks_obtained, er.practical_marks_obtained, er.is_absent, er.grade, er.is_pass,
        es.theory_total_marks AS theory_total, es.practical_total_marks AS practical_total, es.combined_total_marks AS total_marks
      FROM exam_results er
      JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id
      JOIN subjects sub ON sub.id = er.subject_id
      JOIN exams e ON e.id = er.exam_id
      WHERE er.enrollment_id = :enrollment_id
        AND e.exam_type != 'compartment'
      ORDER BY sub.order_number;
    `, { replacements: { enrollment_id } });

    // 3. Fetch Attendance
    const { getAttendancePercent } = require('../utils/attendanceCalculator');
    const attendance = await getAttendancePercent(enrollment_id).catch(() => null);

    // 4. Fetch Remarks
    const [remarks] = await sequelize.query(`
      SELECT remark_text, remark_type, created_at
      FROM student_remarks
      WHERE enrollment_id = :enrollment_id
        AND remark_type = 'academic'
        AND is_deleted = false
      ORDER BY created_at DESC
      LIMIT 1;
    `, { replacements: { enrollment_id } });

    res.ok({
      school: {
        name: data.school_name,
        address: data.school_address,
        phone: data.school_phone,
        email: data.school_email,
        logo_url: data.logo_url,
        principal_name: data.principal_name
      },
      student: {
        first_name: data.first_name,
        last_name: data.last_name,
        admission_no: data.admission_no,
        father_name: data.father_name,
        photo_url: data.photo_url
      },
      enrollment: {
        roll_number: data.roll_number,
        class_name: data.class_name,
        section_name: data.section_name
      },
      session: {
        name: data.session_name
      },
      results: subjectResults,
      attendance,
      finalResult,
      remarks: remarks[0]?.remark_text || 'Satisfactory performance. Keep it up.'
    });
  } catch (err) { next(err); }
};

exports.getReportCard = async (req, res, next) => {
  try {
    const { enrollment_id } = req.params;
    const schoolId = req.user.school_id;

    // 0. Fetch Final Result (checks both existence and release flag)
    const [[finalResult]] = await sequelize.query(`
      SELECT sr.release_result, sr.total_marks, sr.marks_obtained, sr.percentage, sr.grade, sr.result, sr.grace_marks_info
      FROM student_results sr
      JOIN sessions sess ON sess.id = sr.session_id
      WHERE sr.enrollment_id = :enrollment_id AND sess.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { enrollment_id, schoolId } });

    if (!finalResult) {
      return res.fail('Result not yet calculated for this student or access denied.', [], 400);
    }

    const isUserRestricted = ['student', 'parent', 'teacher'].includes(req.user.role);
    if (isUserRestricted && !finalResult.release_result) {
      return res.fail('Result not yet released or access denied.', [], 403);
    }

    // 0a. Fee Check
    const pendingBalance = await getPendingBalance(enrollment_id);
    if (pendingBalance > 0 && !finalResult.release_result) {
      return res.fail(`Result withheld due to pending fees of ${pendingBalance.toFixed(2)}. Please clear dues to download report card.`, [], 403);
    }

    // 1. Fetch Enrollment, Student, School, Session
    const [[data]] = await sequelize.query(`
      SELECT 
        e.id AS enrollment_id, e.roll_number, e.joined_date,
        s.id AS student_id, s.first_name, s.last_name, s.admission_no, s.father_name,
        c.name AS class_name,
        sec.name AS section_name,
        sess.id AS session_id, sess.name AS session_name,
        sch.id AS school_id, sch.name AS school_name, sch.address AS school_address, sch.phone AS school_phone
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      JOIN schools sch ON sch.id = sess.school_id
      WHERE e.id = :enrollment_id AND sess.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { enrollment_id, schoolId } });

    if (!data) return res.fail('Enrollment not found.', [], 404);

    // 2. Fetch Subject Results
    const [subjectResults] = await sequelize.query(`
      SELECT 
        sub.name AS subject, sub.code,
        er.marks_obtained, er.theory_marks_obtained, er.practical_marks_obtained, er.is_absent, er.grade, er.is_pass,
        es.theory_total_marks AS theory_total, es.practical_total_marks AS practical_total, es.combined_total_marks AS total_marks
      FROM exam_results er
      JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id
      JOIN subjects sub ON sub.id = er.subject_id
      JOIN exams e ON e.id = er.exam_id
      WHERE er.enrollment_id = :enrollment_id
        AND e.exam_type != 'compartment'
      ORDER BY sub.order_number;
    `, { replacements: { enrollment_id } });

    // 4. Fetch Attendance
    const { getAttendancePercent } = require('../utils/attendanceCalculator');
    const attendance = await getAttendancePercent(enrollment_id);

    // 5. Generate PDF
    const pdfBuffer = await generateReportCard({
      school: { name: data.school_name, address: data.school_address, phone: data.school_phone },
      student: { first_name: data.first_name, last_name: data.last_name, admission_no: data.admission_no, father_name: data.father_name },
      enrollment: { roll_number: data.roll_number, class_name: data.class_name, section_name: data.section_name },
      session: { name: data.session_name },
      results: subjectResults,
      attendance,
      finalResult
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=ReportCard_${data.admission_no}.pdf`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) { next(err); }
};

// GET /api/results/exam-marks - Get raw exam marks for all students in a section
exports.getExamMarks = async (req, res, next) => {
  try {
    const { exam_id, class_id, section_id } = req.query;
    if (!exam_id || !class_id || !section_id) {
      return res.fail('exam_id, class_id, and section_id are required.');
    }

    const [rows] = await sequelize.query(`
      SELECT 
        er.enrollment_id,
        er.subject_id,
        er.marks_obtained,
        er.theory_marks_obtained,
        er.practical_marks_obtained,
        er.is_absent
      FROM exam_results er
      JOIN enrollments e ON e.id = er.enrollment_id
      WHERE er.exam_id = :examId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active';
    `, {
      replacements: {
        examId: Number(exam_id),
        classId: Number(class_id),
        sectionId: Number(section_id),
      }
    });

    res.ok({ marks: rows });
  } catch (err) { next(err); }
};

// GET /api/results/class - Get results for all students in a class
exports.getClassResults = async (req, res, next) => {
  try {
    const { session_id, class_id, exam_id } = req.query;
    const schoolId = req.user.school_id;

    if (!session_id || !class_id) {
      return res.fail('session_id and class_id are required.');
    }

    // Verify session belongs to school
    const [[sessionCheck]] = await sequelize.query(`
      SELECT id FROM sessions WHERE id = :session_id AND school_id = :schoolId LIMIT 1;
    `, { replacements: { session_id, schoolId } });

    if (!sessionCheck) {
      return res.fail('Session not found or access denied.', [], 404);
    }

    if (exam_id) {
      const [[examCheck]] = await sequelize.query(`
        SELECT id, status, name, exam_type, start_date, end_date, publish_controls
        FROM exams
        WHERE id = :exam_id AND session_id = :session_id AND class_id = :class_id LIMIT 1;
      `, { replacements: { exam_id: Number(exam_id), session_id: Number(session_id), class_id: Number(class_id) } });

      if (!examCheck) {
        return res.fail('Exam not found for the selected session and class.', [], 404);
      }

      let endOfExamMonth = '9999-12-31';
      if (examCheck.start_date) {
        const date = new Date(examCheck.start_date);
        const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        const yyyy = lastDay.getFullYear();
        const mm = String(lastDay.getMonth() + 1).padStart(2, '0');
        const dd = String(lastDay.getDate()).padStart(2, '0');
        endOfExamMonth = `${yyyy}-${mm}-${dd}`;
      }

      // Fetch students with their calculated exam results
      const [results] = await sequelize.query(`
        SELECT
          e.id AS enrollment_id,
          s.admission_no,
          CONCAT(s.first_name, ' ', s.last_name) AS student_name,
          e.roll_number,
          c.name AS class_name,
          sec.name AS section_name,
          COALESCE(exam_sums.marks_obtained, 0) AS marks_obtained,
          COALESCE(exam_sums.total_marks, 0) AS total_marks,
          COALESCE(exam_sums.entered_count, 0) AS entered_count,
          COALESCE(exam_sums.failed_count, 0) AS failed_count,
          COALESCE((
            SELECT SUM(amount_due + late_fee_amount - concession_amount - amount_paid)
            FROM fee_invoices
            WHERE enrollment_id = e.id AND status IN ('pending', 'partial')
              AND due_date <= :endOfExamMonth
          ), 0) AS pending_balance
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN classes c ON c.id = e.class_id
        LEFT JOIN sections sec ON sec.id = e.section_id
        LEFT JOIN LATERAL (
          SELECT 
            SUM(er.marks_obtained) AS marks_obtained,
            SUM(es.combined_total_marks) AS total_marks,
            COUNT(er.marks_obtained) AS entered_count,
            COUNT(CASE WHEN (er.marks_obtained IS NULL AND er.is_absent IS NOT TRUE) OR er.marks_obtained < es.combined_passing_marks OR er.is_absent = true THEN 1 END) AS failed_count
          FROM exam_subjects es
          LEFT JOIN exam_results er 
            ON er.subject_id = es.subject_id 
           AND er.enrollment_id = e.id 
           AND er.exam_id = es.exam_id
          WHERE es.exam_id = :exam_id
        ) exam_sums ON true
        WHERE e.session_id = :session_id AND e.class_id = :class_id AND e.status = 'active'
        ORDER BY (CASE WHEN e.roll_number IS NULL THEN 1 ELSE 0 END), e.roll_number, s.first_name;
      `, {
        replacements: {
          session_id: Number(session_id),
          class_id: Number(class_id),
          exam_id: Number(exam_id),
          endOfExamMonth
        }
      });

      const mappedResults = results.map(r => {
        const total_marks = Number(r.total_marks || 0);
        const marks_obtained = Number(r.marks_obtained || 0);
        const entered_count = Number(r.entered_count || 0);
        const failed_count = Number(r.failed_count || 0);

        let percentage = null;
        let grade = null;
        let result = null;

        if (entered_count > 0) {
          percentage = total_marks > 0 ? Number(((marks_obtained / total_marks) * 100).toFixed(2)) : 0;
          
          if (percentage >= 90) grade = 'A+';
          else if (percentage >= 80) grade = 'A';
          else if (percentage >= 70) grade = 'B';
          else if (percentage >= 60) grade = 'C';
          else if (percentage >= 50) grade = 'D';
          else grade = 'F';

          result = failed_count === 0 ? 'pass' : failed_count <= 2 ? 'compartment' : 'fail';
        }

        return {
          ...r,
          marks_obtained,
          total_marks,
          percentage,
          grade,
          result,
          release_result: examCheck.publish_controls?.results_published === true,
          is_withheld: parseFloat(r.pending_balance) > 0 && !(examCheck.publish_controls?.results_published === true)
        };
      });

      // Calculate overall progress of marks entry
      const totalStudents = results.length;
      const [[subjectCountRow]] = await sequelize.query(`
        SELECT COUNT(*) AS count FROM exam_subjects WHERE exam_id = :exam_id;
      `, { replacements: { exam_id: Number(exam_id) } });
      const totalSubjects = Number(subjectCountRow.count || 0);
      const totalPossibleEntries = totalStudents * totalSubjects;

      const [[filledRow]] = await sequelize.query(`
        SELECT COUNT(*) AS count 
        FROM exam_results 
        WHERE exam_id = :exam_id AND enrollment_id IN (
          SELECT id FROM enrollments WHERE session_id = :session_id AND class_id = :class_id AND status = 'active'
        ) AND (marks_obtained IS NOT NULL OR is_absent = true);
      `, { replacements: { exam_id: Number(exam_id), session_id: Number(session_id), class_id: Number(class_id) } });
      const filledEntries = Number(filledRow.count || 0);
      const progressPercent = totalPossibleEntries > 0 ? Math.round((filledEntries / totalPossibleEntries) * 100) : 0;

      const reviewSummary = await getClassReviewSummary(session_id, class_id);

      res.ok({
        results: mappedResults,
        review_summary: reviewSummary,
        exam_summary: {
          exam_id: examCheck.id,
          name: examCheck.name,
          status: examCheck.status,
          exam_type: examCheck.exam_type,
          start_date: examCheck.start_date,
          end_date: examCheck.end_date,
          progress_percent: progressPercent
        }
      });
    } else {
      const [results] = await sequelize.query(`
        SELECT
          e.id AS enrollment_id,
          s.admission_no,
          CONCAT(s.first_name, ' ', s.last_name) AS student_name,
          e.roll_number,
          c.name AS class_name,
          sec.name AS section_name,
          COALESCE(sr.marks_obtained, 0) AS marks_obtained,
          COALESCE(sr.total_marks, 0) AS total_marks,
          COALESCE(sr.percentage, 0) AS percentage,
          sr.grade,
          sr.result,
          sr.is_promoted,
          sr.compartment_subjects,
          sr.promotion_override_reason,
          sr.release_result,
          COALESCE((
            SELECT SUM(amount_due + late_fee_amount - concession_amount - amount_paid)
            FROM fee_invoices
            WHERE enrollment_id = e.id AND status IN ('pending', 'partial')
          ), 0) AS pending_balance
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN classes c ON c.id = e.class_id
        LEFT JOIN sections sec ON sec.id = e.section_id
        LEFT JOIN student_results sr ON sr.enrollment_id = e.id AND sr.session_id = :session_id
        WHERE e.session_id = :session_id AND e.class_id = :class_id
        ORDER BY (CASE WHEN e.roll_number IS NULL THEN 1 ELSE 0 END), e.roll_number, s.first_name
      `, { 
        replacements: { 
          session_id: Number(session_id), 
          class_id: Number(class_id) 
        } 
      });

      const { getAttendancePercent } = require('../utils/attendanceCalculator');
      const resultsWithWithheld = await Promise.all(results.map(async r => {
        let attendancePct = 0;
        try {
          const stats = await getAttendancePercent(r.enrollment_id);
          attendancePct = stats.percentage;
        } catch (e) {
          console.error('Failed to get attendance for', r.enrollment_id, e);
        }
        return {
          ...r,
          attendance_pct: attendancePct,
          is_withheld: parseFloat(r.pending_balance) > 0 && !r.release_result
        };
      }));

      const reviewSummary = await getClassReviewSummary(session_id, class_id);

      res.ok({
        results: resultsWithWithheld,
        review_summary: reviewSummary,
      });
    }
  } catch (err) { next(err); }
};


exports.downloadClassResultSheet = async (req, res, next) => {
  try {
    const { session_id, class_id, exam_id } = req.query;
    const schoolId = req.user.school_id;

    if (!session_id || !class_id) {
      return res.fail('session_id and class_id are required.');
    }

    const school = await sequelize.query(`SELECT name, address, phone FROM schools WHERE id = :schoolId LIMIT 1`, {
      replacements: { schoolId },
      type: sequelize.QueryTypes.SELECT
    }).then(r => r[0]);

    const [[meta]] = await sequelize.query(`
      SELECT c.name AS class_name, sess.name AS session_name
      FROM classes c
      JOIN sessions sess ON sess.id = :session_id
      WHERE c.id = :class_id LIMIT 1;
    `, { replacements: { class_id, session_id } });

    let subjects = [];
    let students = [];
    let marks = [];
    let exam = null;

    if (exam_id) {
      const [[examRow]] = await sequelize.query(`
        SELECT id, name, status, exam_type
        FROM exams
        WHERE id = :exam_id AND session_id = :session_id AND class_id = :class_id LIMIT 1;
      `, { replacements: { exam_id: Number(exam_id), session_id: Number(session_id), class_id: Number(class_id) } });

      if (!examRow) {
        return res.fail('Exam not found for the selected session and class.', [], 404);
      }
      exam = examRow;

      const [subjectRows] = await sequelize.query(`
        SELECT DISTINCT sub.id, sub.name, sub.code
        FROM subjects sub
        JOIN exam_subjects es ON es.subject_id = sub.id
        WHERE es.exam_id = :exam_id
        ORDER BY sub.name;
      `, { replacements: { exam_id: Number(exam_id) } });
      subjects = subjectRows;

      const [studentRows] = await sequelize.query(`
        SELECT
          e.id AS enrollment_id,
          e.roll_number,
          CONCAT(s.first_name, ' ', s.last_name) AS student_name,
          COALESCE(exam_sums.marks_obtained, 0) AS total_obtained,
          COALESCE(exam_sums.total_marks, 0) AS total_max,
          COALESCE(exam_sums.entered_count, 0) AS entered_count,
          COALESCE(exam_sums.failed_count, 0) AS failed_count
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN LATERAL (
          SELECT 
            SUM(er.marks_obtained) AS marks_obtained,
            SUM(es.combined_total_marks) AS total_marks,
            COUNT(er.marks_obtained) AS entered_count,
            COUNT(CASE WHEN (er.marks_obtained IS NULL AND er.is_absent IS NOT TRUE) OR er.marks_obtained < es.combined_passing_marks OR er.is_absent = true THEN 1 END) AS failed_count
          FROM exam_subjects es
          LEFT JOIN exam_results er 
            ON er.subject_id = es.subject_id 
           AND er.enrollment_id = e.id 
           AND er.exam_id = es.exam_id
          WHERE es.exam_id = :exam_id
        ) exam_sums ON true
        WHERE e.session_id = :session_id AND e.class_id = :class_id AND e.status = 'active'
        ORDER BY COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer, e.roll_number, s.first_name;
      `, { replacements: { session_id, class_id, exam_id: Number(exam_id) } });

      students = studentRows.map(r => {
        const total_max = Number(r.total_max || 0);
        const total_obtained = Number(r.total_obtained || 0);
        const entered_count = Number(r.entered_count || 0);
        const failed_count = Number(r.failed_count || 0);

        let percentage = 0;
        let grade = '-';
        let result = '-';

        if (entered_count > 0) {
          percentage = total_max > 0 ? Number(((total_obtained / total_max) * 100).toFixed(2)) : 0;
          
          if (percentage >= 90) grade = 'A+';
          else if (percentage >= 80) grade = 'A';
          else if (percentage >= 70) grade = 'B';
          else if (percentage >= 60) grade = 'C';
          else if (percentage >= 50) grade = 'D';
          else grade = 'F';

          result = failed_count === 0 ? 'pass' : failed_count <= 2 ? 'compartment' : 'fail';
        }

        return {
          enrollment_id: r.enrollment_id,
          roll_number: r.roll_number,
          student_name: r.student_name,
          total_obtained,
          total_max,
          percentage,
          grade,
          result
        };
      });

      const [markRows] = await sequelize.query(`
        SELECT er.enrollment_id, er.subject_id, er.marks_obtained, er.is_absent
        FROM exam_results er
        WHERE er.exam_id = :exam_id;
      `, { replacements: { exam_id: Number(exam_id) } });
      marks = markRows;

    } else {
      const [subjectRows] = await sequelize.query(`
        SELECT DISTINCT sub.id, sub.name, sub.code
        FROM subjects sub
        JOIN exam_subjects es ON es.subject_id = sub.id
        JOIN exams e ON e.id = es.exam_id
        WHERE e.session_id = :session_id AND e.class_id = :class_id
          AND e.exam_type != 'compartment'
        ORDER BY sub.name;
      `, { replacements: { session_id, class_id } });
      subjects = subjectRows;

      const [studentRows] = await sequelize.query(`
        SELECT
          e.id AS enrollment_id,
          e.roll_number,
          CONCAT(s.first_name, ' ', s.last_name) AS student_name,
          COALESCE(sr.marks_obtained, 0) AS total_obtained,
          COALESCE(sr.total_marks, 0) AS total_max,
          COALESCE(sr.percentage, 0) AS percentage,
          sr.grade,
          sr.result
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        LEFT JOIN student_results sr ON sr.enrollment_id = e.id AND sr.session_id = :session_id
        WHERE e.session_id = :session_id AND e.class_id = :class_id AND e.status = 'active'
        ORDER BY COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer, e.roll_number, s.first_name;
      `, { replacements: { session_id, class_id } });
      students = studentRows;

      const [markRows] = await sequelize.query(`
        SELECT er.enrollment_id, er.subject_id, er.marks_obtained, er.is_absent, e.weightage
        FROM exam_results er
        JOIN exams e ON e.id = er.exam_id
        WHERE e.session_id = :session_id 
          AND e.class_id = :class_id
          AND e.exam_type != 'compartment'
          AND e.status = 'completed';
      `, { replacements: { session_id, class_id } });
      marks = markRows;
    }

    const markMap = {};
    const isAbsentMap = {};

    marks.forEach(m => {
      const eid = m.enrollment_id;
      const sid = m.subject_id;

      if (!markMap[eid]) markMap[eid] = {};
      if (!isAbsentMap[eid]) isAbsentMap[eid] = {};

      if (markMap[eid][sid] === undefined) {
        markMap[eid][sid] = 0;
      }
      
      if (exam_id) {
        const obtained = m.is_absent ? 0 : parseFloat(m.marks_obtained || 0);
        markMap[eid][sid] = obtained;
      } else {
        const weight = parseFloat(m.weightage || 100) / 100;
        const obtained = m.is_absent ? 0 : parseFloat(m.marks_obtained || 0);
        markMap[eid][sid] += (obtained * weight);
      }
      if (m.is_absent) isAbsentMap[eid][sid] = true;
    });

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    const pdfFileName = (exam_id && exam)
      ? `Result_Sheet_${meta.class_name}_${exam.name.replace(/\s+/g, '_')}_${meta.session_name}.pdf`
      : `Class_Result_Sheet_${meta.class_name}_${meta.session_name}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName}"`);
    doc.pipe(res);

    const drawHeader = () => {
      doc.fillColor('#0f766e').fontSize(16).font('Helvetica-Bold').text(school.name.toUpperCase(), { align: 'center' });
      doc.fillColor('#64748b').fontSize(8).font('Helvetica').text(school.address, { align: 'center' });
      doc.moveDown(0.5);
      
      if (exam_id && exam) {
        doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold').text(`CLASS RESULT SHEET - ${exam.name.toUpperCase()}`, { align: 'center' });
        doc.fontSize(10).text(`Class: ${meta.class_name} | Session: ${meta.session_name} | Status: ${exam.status.toUpperCase()}`, { align: 'center' });
      } else {
        doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold').text('CONSOLIDATED CLASS RESULT SHEET', { align: 'center' });
        doc.fontSize(10).text(`Class: ${meta.class_name} | Session: ${meta.session_name}`, { align: 'center' });
      }
      doc.moveDown(1);
    };

    drawHeader();

    const startX = 30;
    const rollWidth = 35;
    const nameWidth = 120;
    const staticColsWidth = 140; // Total, %, Grade, Result
    const availWidth = doc.page.width - 60 - rollWidth - nameWidth - staticColsWidth;
    const subWidth = availWidth / Math.max(subjects.length, 1);
    const rowHeight = 20;

    const drawGridHeader = (y) => {
      doc.fillColor('#f8fafc').rect(startX, y, doc.page.width - 60, rowHeight).fill();
      doc.fillColor('#475569').fontSize(7).font('Helvetica-Bold');
      doc.text('ROLL', startX + 2, y + 6, { width: rollWidth });
      doc.text('STUDENT NAME', startX + rollWidth + 5, y + 6, { width: nameWidth });
      
      subjects.forEach((sub, i) => {
        const x = startX + rollWidth + nameWidth + i * subWidth;
        doc.text(sub.name.toUpperCase(), x, y + 6, { width: subWidth, align: 'center', lineBreak: false });
      });

      const endX = startX + rollWidth + nameWidth + subjects.length * subWidth;
      doc.text('TOTAL', endX + 5, y + 6, { width: 40, align: 'center' });
      doc.text('%', endX + 45, y + 6, { width: 30, align: 'center' });
      doc.text('GR', endX + 75, y + 6, { width: 25, align: 'center' });
      doc.text('RESULT', endX + 100, y + 6, { width: 40, align: 'center' });
    };

    drawGridHeader(doc.y);
    doc.moveDown(0.1);

    students.forEach((student, index) => {
      if (doc.y > 520) {
        doc.addPage();
        drawHeader();
        drawGridHeader(doc.y);
        doc.moveDown(0.1);
      }

      const y = doc.y;
      doc.fillColor('#1e293b').fontSize(7).font('Helvetica');
      
      if (index % 2 === 1) {
        doc.fillColor('#f1f5f9').rect(startX, y, doc.page.width - 60, rowHeight).fill();
        doc.fillColor('#1e293b');
      }

      doc.text(student.roll_number || '-', startX + 2, y + 6, { width: rollWidth });
      doc.text(student.student_name, startX + rollWidth + 5, y + 6, { width: nameWidth, lineBreak: false });

      subjects.forEach((sub, i) => {
        const x = startX + rollWidth + nameWidth + i * subWidth;
        const eid = student.enrollment_id;
        const sid = sub.id;
        
        const rawMark = markMap[eid]?.[sid];
        const mark = rawMark === undefined ? '-' 
                   : (rawMark === 0 && isAbsentMap[eid]?.[sid]) ? 'ABS'
                   : parseFloat(rawMark).toFixed(1);

        doc.text(mark, x, y + 6, { width: subWidth, align: 'center' });
      });

      const endX = startX + rollWidth + nameWidth + subjects.length * subWidth;
      doc.text(`${parseFloat(student.total_obtained).toFixed(0)}/${parseFloat(student.total_max).toFixed(0)}`, endX + 5, y + 6, { width: 40, align: 'center' });
      doc.text(`${student.percentage}%`, endX + 45, y + 6, { width: 30, align: 'center' });
      doc.text(student.grade || '-', endX + 75, y + 6, { width: 25, align: 'center' });
      
      const resColor = student.result === 'pass' ? '#15803d' : student.result === 'fail' ? '#b91c1c' : '#1e293b';
      doc.fillColor(resColor).font('Helvetica-Bold').text((student.result || '-').toUpperCase(), endX + 100, y + 6, { width: 40, align: 'center' });
      doc.fillColor('#1e293b').font('Helvetica');

      doc.moveDown(1);
      doc.strokeColor('#e2e8f0').lineWidth(0.2).moveTo(startX, doc.y).lineTo(doc.page.width - 30, doc.y).stroke();
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#94a3b8').fontSize(8);
      doc.text(`Page ${i + 1} of ${range.count} | Generated on ${new Date().toLocaleString()}`, 30, 550, { align: 'center', width: doc.page.width - 60, lineBreak: false });
    }

    doc.flushPages();
    doc.end();
  } catch (err) { next(err); }
};

exports.calculate = async (req, res, next) => {
  try {
    const { enrollment_id, session_id } = req.body;

    const [[sessionMeta]] = await sequelize.query(`
      SELECT status, is_locked FROM sessions WHERE id = :sessionId LIMIT 1;
    `, { replacements: { sessionId: session_id } });

    if (!sessionMeta) return res.fail('Session not found.', [], 404);
    if (['closed', 'archived', 'locked'].includes(sessionMeta.status) || sessionMeta.is_locked) {
      return res.fail(`Cannot calculate results: session is ${sessionMeta.status}.`);
    }

    const [[enrollment]] = await sequelize.query(`
      SELECT id, class_id
      FROM enrollments
      WHERE id = :enrollmentId
        AND session_id = :sessionId
      LIMIT 1;
    `, {
      replacements: {
        enrollmentId: enrollment_id,
        sessionId: session_id,
      },
    });

    if (!enrollment) {
      return res.fail('Enrollment not found for the selected session.', [], 404);
    }

    const reviewSummary = await getClassReviewSummary(session_id, enrollment.class_id);
    if (reviewSummary.submitted_count > 0 || reviewSummary.rejected_count > 0) {
      return res.fail('Approve all submitted marks before calculating final results.', [], 422);
    }

    const result = await examEngine.calculateResult(enrollment_id, session_id);
    invalidateCache(req.user.school_id, '/api/results*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    res.ok(result, `Result calculated: ${result.result.toUpperCase()} (${result.percentage}%).`);
  } catch (err) { next(err); }
};

exports.bulkCalculate = async (req, res, next) => {
  try {
    const { session_id, class_id, calculate = true, release = true } = req.body;

    if (!session_id || !class_id) {
      return res.fail('session_id and class_id are required.');
    }

    const [[sessionMeta]] = await sequelize.query(`
      SELECT status, is_locked FROM sessions WHERE id = :sessionId LIMIT 1;
    `, { replacements: { sessionId: session_id } });

    if (!sessionMeta) return res.fail('Session not found.', [], 404);
    if (['closed', 'archived', 'locked'].includes(sessionMeta.status) || sessionMeta.is_locked) {
      return res.fail(`Cannot modify results: session is ${sessionMeta.status}.`);
    }

    const reviewSummary = await getClassReviewSummary(session_id, class_id);
    if (calculate && (reviewSummary.submitted_count > 0 || reviewSummary.rejected_count > 0)) {
      return res.fail('Approve all submitted marks before calculating final results.', [], 422);
    }

    const [enrollments] = await sequelize.query(`
      SELECT id FROM enrollments 
      WHERE session_id = :session_id AND class_id = :class_id AND status = 'active';
    `, { replacements: { session_id, class_id } });

    if (enrollments.length === 0) {
      return res.fail('No active enrollments found for this class and session.');
    }

    const summary = {
      total: enrollments.length,
      calculated: 0,
      released: 0,
      failed: 0,
      errors: []
    };

    for (const enr of enrollments) {
      try {
        if (calculate) {
          await examEngine.calculateResult(enr.id, session_id);
          summary.calculated++;
        }

        if (release !== undefined) {
          const [[exists]] = await sequelize.query(`
            SELECT id FROM student_results WHERE enrollment_id = :enrollment_id LIMIT 1;
          `, { replacements: { enrollment_id: enr.id } });

          if (exists) {
            await sequelize.query(`
              UPDATE student_results
              SET release_result = :releaseVal,
                  released_by = :userId,
                  updated_at = NOW()
              WHERE enrollment_id = :enrollment_id;
            `, {
              replacements: {
                enrollment_id: enr.id,
                userId: req.user.id,
                releaseVal: !!release
              }
            });
            if (release) {
              summary.released++;
            } else {
              summary.unreleased = (summary.unreleased || 0) + 1;
            }
          }
        }
      } catch (err) {
        summary.failed++;
        summary.errors.push({ enrollment_id: enr.id, error: err.message });
      }
    }

    res.ok(summary, `Processed ${summary.total} student(s). ${summary.calculated} calculated, ${summary.released} released.`);
    invalidateCache(req.user.school_id, '/api/results*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

exports.release = async (req, res, next) => {
  try {
    const { enrollment_id, release } = req.body;

    const [[result]] = await sequelize.query(`
      SELECT sr.id, s.status AS session_status, s.is_locked AS session_locked
      FROM student_results sr
      JOIN sessions s ON s.id = sr.session_id
      WHERE sr.enrollment_id = :enrollment_id LIMIT 1;
    `, { replacements: { enrollment_id } });

    if (!result) {
      return res.fail('Result not yet calculated for this student. Calculate result before releasing.', [], 400);
    }

    if (['closed', 'archived', 'locked'].includes(result.session_status) || result.session_locked) {
      return res.fail(`Cannot modify result release status: session is ${result.session_status}.`);
    }

    await sequelize.query(`
      UPDATE student_results
      SET release_result = :release,
          released_by = :userId,
          updated_at = NOW()
      WHERE enrollment_id = :enrollment_id;
    `, {
      replacements: {
        enrollment_id,
        release: !!release,
        userId: req.user.id
      }
    });

    await writeAuditLog(sequelize, {
      tableName: 'student_results',
      recordId: enrollment_id,
      changes: { field: 'release_result', oldValue: String(!release), newValue: String(!!release) },
      changedBy: req.user.id,
      reason: `Result ${release ? 'released' : 'withheld'}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    invalidateCache(req.user.school_id, '/api/results*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    res.ok({ enrollment_id, release_result: !!release }, `Result ${release ? 'released' : 'withheld'} successfully.`);
  } catch (err) { next(err); }
};

exports.override = async (req, res, next) => {
  try {
    const { enrollment_id, new_result, reason, compartment_subjects } = req.body;

    const [[enrollment]] = await sequelize.query(`
      SELECT e.id, s.status AS session_status, s.is_locked AS session_locked
      FROM enrollments e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.id = :enrollment_id LIMIT 1;
    `, { replacements: { enrollment_id } });

    if (!enrollment) return res.fail('Enrollment not found.', [], 404);
    if (['closed', 'archived', 'locked'].includes(enrollment.session_status) || enrollment.session_locked) {
      return res.fail(`Cannot override result: session is ${enrollment.session_status}.`);
    }

    const result = await examEngine.overrideResult(enrollment_id, new_result, reason, req.user.id, compartment_subjects);

    await writeAuditLog(sequelize, {
      tableName: 'student_results',
      recordId: enrollment_id,
      changes: { field: 'result', oldValue: result.oldResult, newValue: result.newResult },
      changedBy: req.user.id,
      reason: `Result override: ${reason}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    invalidateCache(req.user.school_id, '/api/results*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    res.ok(result, `Result overridden: ${result.oldResult} → ${result.newResult}.`);
  } catch (err) { next(err); }
};

exports.overrideMark = async (req, res, next) => {
  try {
    const {
      exam_id,
      enrollment_id,
      subject_id,
      is_absent = false,
      marks_obtained = null,
      theory_marks_obtained = null,
      practical_marks_obtained = null,
      reason,
    } = req.body;

    const [[exam]] = await sequelize.query(`
      SELECT e.id, e.class_id, e.session_id, s.status AS session_status, s.is_locked AS session_locked
      FROM exams e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.id = :examId
      LIMIT 1;
    `, { replacements: { examId: exam_id } });

    if (!exam) {
      return res.fail('Exam not found.', [], 404);
    }

    if (['closed', 'archived', 'locked'].includes(exam.session_status) || exam.session_locked) {
      return res.fail(`Cannot override marks: session is ${exam.session_status}.`);
    }

    const [[enrollment]] = await sequelize.query(`
      SELECT id, class_id, session_id
      FROM enrollments
      WHERE id = :enrollmentId
      LIMIT 1;
    `, { replacements: { enrollmentId: enrollment_id } });

    if (!enrollment) {
      return res.fail('Enrollment not found.', [], 404);
    }

    if (Number(enrollment.class_id) !== Number(exam.class_id) || Number(enrollment.session_id) !== Number(exam.session_id)) {
      return res.fail('Selected student does not belong to this exam class/session.', [], 422);
    }

    const [[subject]] = await sequelize.query(`
      SELECT
        es.subject_id,
        es.subject_type,
        es.theory_total_marks,
        es.theory_passing_marks,
        es.practical_total_marks,
        es.practical_passing_marks,
        es.combined_total_marks,
        es.combined_passing_marks
      FROM exam_subjects es
      WHERE es.exam_id = :examId
        AND es.subject_id = :subjectId
      LIMIT 1;
    `, {
      replacements: {
        examId: exam_id,
        subjectId: subject_id,
      },
    });

    if (!subject) {
      return res.fail('Subject is not configured for this exam.', [], 422);
    }

    let finalMarks = null;
    let theoryMarks = null;
    let practicalMarks = null;

    if (!is_absent) {
      if (subject.subject_type === 'both') {
        theoryMarks = theory_marks_obtained === '' || theory_marks_obtained == null ? null : Number(theory_marks_obtained);
        practicalMarks = practical_marks_obtained === '' || practical_marks_obtained == null ? null : Number(practical_marks_obtained);

        if (!Number.isFinite(theoryMarks) || !Number.isFinite(practicalMarks)) {
          return res.fail('Both theory and practical marks are required for this subject.', [], 422);
        }
        if (theoryMarks < 0 || theoryMarks > Number(subject.theory_total_marks || 0)) {
          return res.fail(`Theory marks must be between 0 and ${subject.theory_total_marks}.`, [], 422);
        }
        if (practicalMarks < 0 || practicalMarks > Number(subject.practical_total_marks || 0)) {
          return res.fail(`Practical marks must be between 0 and ${subject.practical_total_marks}.`, [], 422);
        }

        finalMarks = Number((theoryMarks + practicalMarks).toFixed(2));
      } else {
        finalMarks = marks_obtained === '' || marks_obtained == null ? null : Number(marks_obtained);
        if (!Number.isFinite(finalMarks)) {
          return res.fail('Marks are required for this subject.', [], 422);
        }
        if (finalMarks < 0 || finalMarks > Number(subject.combined_total_marks || 0)) {
          return res.fail(`Marks must be between 0 and ${subject.combined_total_marks}.`, [], 422);
        }
      }
    }

    const gradingScale = await examEngine.getActiveGradingScale(exam.school_id);
    const { grade, isPass } = examEngine.calcSubjectResult(
      finalMarks,
      Number(subject.combined_total_marks || 0),
      Number(subject.combined_passing_marks || 0),
      !!is_absent,
      gradingScale
    );

    // Fetch old result for history
    const [[oldResult]] = await sequelize.query(
      `SELECT marks_obtained, theory_marks_obtained, practical_marks_obtained, is_absent 
       FROM exam_results 
       WHERE exam_id = :exam_id AND enrollment_id = :enrollment_id AND subject_id = :subject_id 
       LIMIT 1;`,
      { replacements: { exam_id, enrollment_id, subject_id }, transaction: null }
    );

    const [updatedRows] = await sequelize.query(`
      UPDATE exam_results
      SET marks_obtained = :marks,
          theory_marks_obtained = :theoryMarks,
          practical_marks_obtained = :practicalMarks,
          is_absent = :isAbsent,
          grade = :grade,
          is_pass = :isPass,
          override_by = :userId,
          override_reason = :reason,
          updated_at = NOW()
      WHERE exam_id = :examId
        AND enrollment_id = :enrollmentId
        AND subject_id = :subjectId
      RETURNING exam_id, enrollment_id, subject_id, marks_obtained, theory_marks_obtained,
        practical_marks_obtained, is_absent, grade, is_pass, override_reason, override_by, updated_at;
    `, {
      replacements: {
        examId: exam_id,
        enrollmentId: enrollment_id,
        subjectId: subject_id,
        marks: finalMarks,
        theoryMarks,
        practicalMarks,
        isAbsent: !!is_absent,
        grade,
        isPass,
        userId: req.user.id,
        reason,
      },
    });

    if (updatedRows.length === 0) {
      return res.fail('Teacher marks have not been entered for this student yet.', [], 404);
    }

    // Log to audit_logs
    await writeAuditLog(sequelize, {
      tableName: 'exam_results',
      recordId: `${exam_id}_${enrollment_id}_${subject_id}`,
      changes: { field: 'marks_obtained', oldValue: String(oldResult?.marks_obtained || 0), newValue: String(finalMarks) },
      changedBy: req.user.id,
      reason: `Mark override: ${reason}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    // Log to MarkHistory
    await MarkHistory.create({
      exam_id,
      enrollment_id,
      subject_id,
      old_marks_obtained: oldResult?.marks_obtained,
      new_marks_obtained: finalMarks,
      old_theory_marks: oldResult?.theory_marks_obtained,
      new_theory_marks: theoryMarks,
      old_practical_marks: oldResult?.practical_marks_obtained,
      new_practical_marks: practicalMarks,
      old_is_absent: oldResult?.is_absent,
      new_is_absent: !!is_absent,
      changed_by: req.user.id,
      change_reason: reason,
      change_type: 'override',
    });

    const [[resultRow]] = await sequelize.query(`
      SELECT id
      FROM student_results
      WHERE enrollment_id = :enrollmentId
        AND session_id = :sessionId
      LIMIT 1;
    `, {
      replacements: {
        enrollmentId: enrollment_id,
        sessionId: exam.session_id,
      },
    });

    if (resultRow) {
      await examEngine.calculateResult(enrollment_id, exam.session_id);
    }

    invalidateCache(exam.school_id, '/api/results*');
    invalidateCache(exam.school_id, '/api/dashboard*');
    res.ok(updatedRows[0], 'Marks overridden successfully.');
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    return res.fail('Deleting calculated results is disabled. Use admin override if a correction is needed.', [], 403);
  } catch (err) { next(err); }
};
