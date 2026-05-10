'use strict';

/**
 * utils/examEngine.js
 *
 * Three exam result functions + one shared grade calculator.
 * No Express — called by controllers in Step 9.
 *
 * Result decision tree:
 *
 *   attendance < 75%
 *       └─► FAIL  (attendance rule overrides marks entirely)
 *
 *   core subjects failed = 0
 *       └─► PASS
 *
 *   core subjects failed = 1 or 2
 *       └─► COMPARTMENT  (eligible for re-exam)
 *
 *   core subjects failed > 2
 *       └─► FAIL
 */

const sequelize            = require('../config/database');
const { getAttendancePercent } = require('./attendanceCalculator');
const auditLogger          = require('./auditLogger');
const { GradingScale, MarkHistory, StudentResult } = require('../models');

const RESULT_RULES = {
  minAttendancePercent: Number(process.env.RESULT_MIN_ATTENDANCE_PERCENT || 75),
  maxCoreFailuresForCompartment: Number(process.env.RESULT_MAX_CORE_FAILURES_FOR_COMPARTMENT || 2),
  graceMarksLimit: Number(process.env.RESULT_GRACE_MARKS_LIMIT || 2), // Max marks to award as grace
  grades: [
    { min: Number(process.env.GRADE_A_PLUS_MIN || 90), grade: 'A+' },
    { min: Number(process.env.GRADE_A_MIN || 80), grade: 'A' },
    { min: Number(process.env.GRADE_B_PLUS_MIN || 70), grade: 'B+' },
    { min: Number(process.env.GRADE_B_MIN || 60), grade: 'B' },
    { min: Number(process.env.GRADE_C_MIN || 50), grade: 'C' },
    { min: Number(process.env.GRADE_D_MIN || 40), grade: 'D' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED: Grade calculator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the active grading scale for a school.
 */
async function getActiveGradingScale(schoolId) {
  const scale = await GradingScale.findOne({
    where: { school_id: schoolId, is_default: true }
  });
  
  if (scale && Array.isArray(scale.definition)) {
    return scale.definition.sort((a, b) => b.min - a.min);
  }
  
  return RESULT_RULES.grades;
}

/**
 * Converts a percentage to a letter grade.
 * Applied consistently to both subject-level and session-level percentages.
 */
function percentageToGrade(pct, gradingScale = RESULT_RULES.grades) {
  for (const band of gradingScale) {
    if (pct >= band.min) return band.grade;
  }
  return 'F';
}

/**
 * Calculates grade and pass/fail for a single subject result.
 * @param {number} marksObtained
 * @param {number} totalMarks
 * @param {number} passingMarks
 * @param {boolean} isAbsent
 * @param {Array} gradingScale
 */
function calcSubjectResult(marksObtained, totalMarks, passingMarks, isAbsent, gradingScale = RESULT_RULES.grades) {
  if (isAbsent) {
    return { grade: 'F', isPass: false, percentage: 0 };
  }
  const pct    = parseFloat(((marksObtained / totalMarks) * 100).toFixed(2));
  const isPass = marksObtained >= passingMarks;
  return { grade: percentageToGrade(pct, gradingScale), isPass, percentage: pct };
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 1: calculateResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates and SAVES the final session result for one student.
 *
 * Algorithm:
 *   1. Fetch all exam_results for this enrollment across all approved exams
 *   2. Check attendance percentage — if < 75%, result = FAIL regardless
 *   3. Aggregate marks across all subjects, respecting exam weightage
 *   4. Check core subject pass/fail individually
 *   5. Apply grace marks if enabled and student is close to passing
 *   6. Apply result rule: 0 failed = pass, 1-2 failed = compartment, 3+ = fail
 *   7. Upsert into student_results
 */
async function calculateResult(enrollmentId, sessionId) {

  // Fetch school_id for grading scale
  const [[enrollmentMeta]] = await sequelize.query(`
    SELECT s.school_id
    FROM enrollments e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.id = :enrollmentId
    LIMIT 1;
  `, { replacements: { enrollmentId } });

  const gradingScale = await getActiveGradingScale(enrollmentMeta.school_id);

  // ── Step 1: Fetch all completed exam results for this enrollment ─────────
  const [examResults] = await sequelize.query(`
    SELECT
      er.id,
      er.marks_obtained,
      er.is_absent,
      er.is_pass,
      sub.id            AS subject_id,
      sub.name          AS subject_name,
      es.combined_total_marks   AS subject_total,
      es.combined_passing_marks AS subject_passing,
      sub.is_core,
      e.exam_type,
      e.status          AS exam_status,
      e.weightage,
      es.review_status
    FROM exam_results  er
    JOIN exams         e   ON e.id   = er.exam_id
    JOIN exam_subjects es  ON es.exam_id = er.exam_id
                           AND es.subject_id = er.subject_id
    JOIN subjects      sub ON sub.id = er.subject_id
    WHERE er.enrollment_id = :enrollmentId
      AND e.session_id     = :sessionId
      AND es.review_status = 'approved'
      AND e.exam_type     != 'compartment';
  `, { replacements: { enrollmentId, sessionId } });

  if (examResults.length === 0) {
    throw new Error(
      `No completed exam results found for enrollment_id=${enrollmentId} in session_id=${sessionId}.`
    );
  }

  // ── Step 2: Attendance check ─────────────────────────────────────────────
  const attendanceStats = await getAttendancePercent(enrollmentId);
  const attendancePct   = attendanceStats.percentage;
  const failedAttendance = attendancePct < RESULT_RULES.minAttendancePercent;

  // ── Step 3: Aggregate marks with Weightage ───────────────────────────────
  let weightedTotalMax    = 0;
  let weightedTotalObtained = 0;

  // Consolidate by subject
  const subjectMap = {};

  for (const row of examResults) {
    const key = row.subject_id;
    const weight = parseFloat(row.weightage || 100) / 100;
    
    if (!subjectMap[key]) {
      subjectMap[key] = {
        subject_id      : row.subject_id,
        subject_name    : row.subject_name,
        is_core         : row.is_core,
        total_marks     : 0,
        passing_marks   : parseFloat(row.subject_passing), // This needs to be weighted if aggregated
        obtained        : 0,
        is_absent       : false,
        max_possible    : 0,
      };
    }
    
    // Weighted aggregation
    const rowMax = parseFloat(row.subject_total);
    const rowObtained = row.is_absent ? 0 : parseFloat(row.marks_obtained || 0);
    
    subjectMap[key].max_possible += rowMax * weight;
    subjectMap[key].obtained     += rowObtained * weight;
    
    // We assume passing_marks is defined per exam, but for final result we need a threshold.
    // If multiple exams, we could sum weighted passing marks or use a percentage.
    // Standard approach: if overall % < 40% (or whatever is in grading scale), fail.
    // But since we have core subject rules, we'll use aggregated weighted passing marks.
    subjectMap[key].total_marks  += rowMax; // Non-weighted total for reporting
    
    if (row.is_absent) subjectMap[key].is_absent = true;
  }

  const subjectSummaries    = Object.values(subjectMap);
  const failedCoreSubjects  = [];
  const graceAwards         = [];

  for (const sub of subjectSummaries) {
    weightedTotalMax      += sub.max_possible;
    weightedTotalObtained += sub.obtained;

    // Recalculate pass/fail using aggregated marks
    // We need a combined passing threshold. Usually, it's 33% or 40% of max_possible.
    // For simplicity, we'll sum the weighted passing marks.
    // Actually, let's recalculate based on percentage of max_possible.
    const passingThreshold = (sub.passing_marks / sub.total_marks) * sub.max_possible;
    
    let subPassed = !sub.is_absent && (sub.obtained >= passingThreshold);

    // Apply Grace Marks Logic
    if (sub.is_core && !subPassed && !sub.is_absent) {
      const deficiency = passingThreshold - sub.obtained;
      if (deficiency > 0 && deficiency <= RESULT_RULES.graceMarksLimit) {
        subPassed = true;
        graceAwards.push({
          subject_id: sub.subject_id,
          subject_name: sub.subject_name,
          grace_marks: parseFloat(deficiency.toFixed(2))
        });
      }
    }

    if (sub.is_core && !subPassed) {
      failedCoreSubjects.push({
        subject_id   : sub.subject_id,
        subject_name : sub.subject_name,
        obtained     : sub.obtained,
        passing_marks: passingThreshold,
        total_marks  : sub.max_possible,
      });
    }
  }

  // ── Step 4: Apply result rules ────────────────────────────────────────────
  const percentage         = parseFloat(((weightedTotalObtained / weightedTotalMax) * 100).toFixed(2));
  const overallGrade       = percentageToGrade(percentage, gradingScale);
  const failedCoreCount    = failedCoreSubjects.length;

  let result;
  let compartmentSubjects = null;
  let isPromoted          = false;

  if (failedAttendance) {
    result      = 'fail';
    isPromoted  = false;
  } else if (failedCoreCount === 0) {
    result      = 'pass';
    isPromoted  = true;
  } else if (failedCoreCount <= RESULT_RULES.maxCoreFailuresForCompartment) {
    result             = 'compartment';
    compartmentSubjects = failedCoreSubjects.map(s => s.subject_id);
    isPromoted         = false;
  } else {
    result      = 'fail';
    isPromoted  = false;
  }

  // ── Step 5: Upsert student_results ───────────────────────────────────────
  const [existing] = await sequelize.query(`
    SELECT id, is_locked FROM student_results WHERE enrollment_id = :enrollmentId LIMIT 1;
  `, { replacements: { enrollmentId } });

  if (existing.length > 0 && existing[0].is_locked) {
    throw new Error('This result is locked and cannot be recalculated.');
  }

  const resultPayload = {
    enrollment_id         : enrollmentId,
    session_id            : sessionId,
    total_marks           : weightedTotalMax.toFixed(2),
    marks_obtained        : weightedTotalObtained.toFixed(2),
    percentage,
    grade                 : overallGrade,
    result,
    compartment_subjects  : compartmentSubjects ? JSON.stringify(compartmentSubjects) : null,
    is_promoted           : isPromoted,
    grace_marks_info      : graceAwards.length > 0 ? JSON.stringify(graceAwards) : null,
    updated_at            : new Date(),
  };

  if (existing.length > 0) {
    await sequelize.query(`
      UPDATE student_results SET
        total_marks          = :total_marks,
        marks_obtained       = :marks_obtained,
        percentage           = :percentage,
        grade                = :grade,
        result               = :result,
        compartment_subjects = :compartment_subjects,
        is_promoted          = :is_promoted,
        updated_at           = NOW()
      WHERE enrollment_id = :enrollment_id;
    `, { replacements: resultPayload });
  } else {
    await sequelize.query(`
      INSERT INTO student_results
        (enrollment_id, session_id, total_marks, marks_obtained, percentage,
         grade, result, compartment_subjects, is_promoted,
         promotion_override_by, promotion_override_reason, created_at, updated_at)
      VALUES
        (:enrollment_id, :session_id, :total_marks, :marks_obtained, :percentage,
         :grade, :result, :compartment_subjects, :is_promoted,
         NULL, NULL, NOW(), NOW());
    `, { replacements: resultPayload });
  }

  // Log Grace Marks in MarkHistory or AuditLog?
  // MarkHistory seems more appropriate for specific subject changes.
  // But Grace Marks are applied at the session level aggregation.
  // Let's log them in AuditLog for now if needed.

  return {
    enrollmentId,
    sessionId,
    totalMarks: weightedTotalMax,
    marksObtained: weightedTotalObtained,
    percentage,
    grade: overallGrade,
    result,
    failedCoreSubjects,
    compartmentSubjects,
    isPromoted,
    attendancePct,
    failedAttendance,
    graceAwards,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 2: processCompartment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates compartment exam marks for one subject and recalculates overall result.
 *
 * Steps:
 *   1. Validate a compartment exam exists for this session
 *   2. Upsert exam_result for the compartment exam + this subject
 *   3. Recalculate full result via calculateResult()
 *   4. If now passes → is_promoted = true, compartment_subjects cleared
 *   5. Return updated result
 *
 * @param {number} enrollmentId
 * @param {number} subjectId
 * @param {number} newMarks
 * @param {number} enteredBy   user id
 */
async function processCompartment(enrollmentId, subjectId, newMarks, enteredBy) {
  return sequelize.transaction(async (t) => {

    // ── Fetch enrollment + session ────────────────────────────────────────
    const [[enrollment]] = await sequelize.query(`
      SELECT e.id, e.session_id, e.class_id
      FROM enrollments e
      WHERE e.id = :enrollmentId;
    `, { replacements: { enrollmentId }, transaction: t });

    if (!enrollment) throw new Error(`Enrollment id=${enrollmentId} not found.`);

    // ── Verify student is in compartment status ───────────────────────────
    const [[currentResult]] = await sequelize.query(`
      SELECT id, result, compartment_subjects
      FROM student_results
      WHERE enrollment_id = :enrollmentId;
    `, { replacements: { enrollmentId }, transaction: t });

    if (!currentResult || currentResult.result !== 'compartment') {
      throw new Error(
        `Enrollment id=${enrollmentId} is not in compartment status. ` +
        `Current result: ${currentResult?.result || 'not calculated'}.`
      );
    }

    // ── Fetch subject details for grade calc ─────────────────────────────
    const [[subject]] = await sequelize.query(`
      SELECT id, total_marks, passing_marks FROM subjects WHERE id = :subjectId;
    `, { replacements: { subjectId }, transaction: t });

    if (!subject) throw new Error(`Subject id=${subjectId} not found.`);

    if (newMarks > parseFloat(subject.total_marks)) {
      throw new Error(
        `Marks entered (${newMarks}) exceed subject total marks (${subject.total_marks}).`
      );
    }

    // ── Find or create the compartment exam for this session/class ────────
    const [[compartmentExam]] = await sequelize.query(`
      SELECT id FROM exams
      WHERE session_id = :sessionId
        AND class_id   = :classId
        AND exam_type  = 'compartment'
        AND status IN ('completed', 'published')
      LIMIT 1;
    `, {
      replacements: { sessionId: enrollment.session_id, classId: enrollment.class_id },
      transaction: t,
    });

    if (!compartmentExam) {
      throw new Error(
        `No completed compartment exam found for session_id=${enrollment.session_id}, ` +
        `class_id=${enrollment.class_id}. Create and complete the compartment exam first.`
      );
    }

    // ── Calculate grade for this compartment result ───────────────────────
    const { grade, isPass } = calcSubjectResult(
      newMarks,
      parseFloat(subject.total_marks),
      parseFloat(subject.passing_marks),
      false
    );

    // ── Upsert exam_result for compartment exam ───────────────────────────
    const [existingResult] = await sequelize.query(`
      SELECT id FROM exam_results
      WHERE exam_id       = :examId
        AND enrollment_id = :enrollmentId
        AND subject_id    = :subjectId;
    `, {
      replacements: { examId: compartmentExam.id, enrollmentId, subjectId },
      transaction: t,
    });

    if (existingResult.length > 0) {
      await sequelize.query(`
        UPDATE exam_results SET
          marks_obtained  = :marks,
          is_absent       = false,
          grade           = :grade,
          is_pass         = :isPass,
          entered_by      = :enteredBy,
          updated_at      = NOW()
        WHERE id = :id;
      `, {
        replacements: { marks: newMarks, grade, isPass, enteredBy, id: existingResult[0].id },
        transaction: t,
      });
    } else {
      await sequelize.query(`
        INSERT INTO exam_results
          (exam_id, enrollment_id, subject_id, marks_obtained, is_absent,
           grade, is_pass, entered_by, override_by, override_reason, created_at, updated_at)
        VALUES
          (:examId, :enrollmentId, :subjectId, :marks, false,
           :grade, :isPass, :enteredBy, NULL, NULL, NOW(), NOW());
      `, {
        replacements: {
          examId: compartmentExam.id, enrollmentId, subjectId,
          marks: newMarks, grade, isPass, enteredBy,
        },
        transaction: t,
      });
    }

    // ── Recalculate full result (runs outside transaction — reads committed data)
    // We commit first, then recalculate
    // NOTE: recalculation happens after transaction commits in the caller
    return {
      enrollmentId,
      subjectId,
      newMarks,
      subjectGrade     : grade,
      subjectPass      : isPass,
      compartmentExamId: compartmentExam.id,
      sessionId        : enrollment.session_id,
    };
  }).then(async (interim) => {
    // Recalculate now that transaction is committed
    const newResult = await calculateResult(interim.enrollmentId, interim.sessionId);
    return {
      ...interim,
      updatedResult: newResult,
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 3: overrideResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Admin override of a student's final result.
 *
 * Steps:
 *   1. Read current result — save to audit_log
 *   2. Apply new result
 *   3. If new result is 'pass', set is_promoted = true
 *   4. If new result is 'fail' or 'detained', set is_promoted = false
 *   5. Write audit log entry
 *
 * @param {number} enrollmentId
 * @param {'pass'|'fail'|'compartment'|'detained'} newResult
 * @param {string} reason    min 10 chars
 * @param {number} adminId
 */
async function overrideResult(enrollmentId, newResult, reason, adminId) {
  if (!reason || reason.trim().length < 10) {
    throw new Error('Override reason must be at least 10 characters.');
  }

  const validResults = ['pass', 'fail', 'compartment', 'detained'];
  if (!validResults.includes(newResult)) {
    throw new Error(`Invalid result value. Must be one of: ${validResults.join(', ')}.`);
  }

  return sequelize.transaction(async (t) => {

    // ── Fetch current result ──────────────────────────────────────────────
    const [[current]] = await sequelize.query(`
      SELECT id, result, is_promoted, percentage, grade
      FROM student_results
      WHERE enrollment_id = :enrollmentId
      FOR UPDATE;
    `, { replacements: { enrollmentId }, transaction: t });

    if (!current) {
      throw new Error(
        `No student_result found for enrollment_id=${enrollmentId}. ` +
        `Run calculateResult() first.`
      );
    }

    const oldResult    = current.result;
    const isPromoted   = newResult === 'pass';

    // ── Update student_results ────────────────────────────────────────────
    await sequelize.query(`
      UPDATE student_results SET
        result                    = :newResult,
        is_promoted               = :isPromoted,
        compartment_subjects      = CASE WHEN :newResult = 'compartment'
                                         THEN compartment_subjects
                                         ELSE NULL END,
        promotion_override_by     = :adminId,
        promotion_override_reason = :reason,
        updated_at                = NOW()
      WHERE enrollment_id = :enrollmentId;
    `, {
      replacements: { newResult, isPromoted, adminId, reason, enrollmentId },
      transaction: t,
    });

    // ── Write audit log ───────────────────────────────────────────────────
    await sequelize.getQueryInterface().bulkInsert('audit_logs', [{
      table_name  : 'student_results',
      record_id   : current.id,
      field_name  : 'result',
      old_value   : oldResult,
      new_value   : newResult,
      changed_by  : adminId,
      reason      : reason.trim(),
      ip_address  : null,    // Populated by controller in Step 9
      device_info : null,
      created_at  : new Date(),
    }], { transaction: t });

    // Also log is_promoted change
    await sequelize.getQueryInterface().bulkInsert('audit_logs', [{
      table_name  : 'student_results',
      record_id   : current.id,
      field_name  : 'is_promoted',
      old_value   : String(current.is_promoted),
      new_value   : String(isPromoted),
      changed_by  : adminId,
      reason      : reason.trim(),
      ip_address  : null,
      device_info : null,
      created_at  : new Date(),
    }], { transaction: t });

    return {
      enrollmentId,
      oldResult,
      newResult,
      oldIsPromoted : current.is_promoted,
      newIsPromoted : isPromoted,
      reason,
      adminId,
      auditRowsWritten: 2,
    };
  });
}


/**
 * Core logic for entering marks for a student in an exam.
 * Used by both individual entry and bulk upload.
 */
async function saveStudentMarks(data, transaction = null) {
  const { exam, enrollment_id, results, userId, gradingScale } = data;
  const exam_id = exam.id;
  const saved = [];

  const useTransaction = async (work) => {
    if (transaction) return work(transaction);
    return sequelize.transaction(work);
  };

  return useTransaction(async (t) => {
    for (const r of results) {
      const [[subject]] = await sequelize.query(
        `SELECT es.subject_id AS id, s.class_id, es.subject_type, es.combined_total_marks, es.combined_passing_marks,
                es.theory_total_marks, es.theory_passing_marks, es.practical_total_marks, es.practical_passing_marks,
                es.assigned_teacher_id
         FROM exam_subjects es
         JOIN subjects s ON s.id = es.subject_id
         WHERE es.exam_id = :examId
           AND es.subject_id = :sid
         LIMIT 1;`,
        { replacements: { examId: exam_id, sid: r.subject_id }, transaction: t }
      );
      if (!subject) {
        throw Object.assign(
          new Error(`Subject ${r.subject_id} is not configured for this exam.`),
          { status: 422 }
        );
      }

      // Teacher role check should be done in controller, but we can pass a flag if needed.

      const isAbsent = r.is_absent === true || String(r.is_absent).toLowerCase() === 'true' || String(r.is_absent).toLowerCase() === 'yes';
      let finalMarks = null;
      let theoryMarks = null;
      let practicalMarks = null;

      if (!isAbsent) {
        if (subject.subject_type === 'both') {
          theoryMarks = r.theory_marks_obtained === '' || r.theory_marks_obtained == null ? null : parseFloat(r.theory_marks_obtained);
          practicalMarks = r.practical_marks_obtained === '' || r.practical_marks_obtained == null ? null : parseFloat(r.practical_marks_obtained);

          if (theoryMarks != null && theoryMarks > parseFloat(subject.theory_total_marks)) {
            throw Object.assign(new Error(`Theory marks for ${r.subject_id} exceed limit.`), { status: 422 });
          }
          if (practicalMarks != null && practicalMarks > parseFloat(subject.practical_total_marks)) {
            throw Object.assign(new Error(`Practical marks for ${r.subject_id} exceed limit.`), { status: 422 });
          }
          finalMarks = (theoryMarks || 0) + (practicalMarks || 0);
        } else {
          finalMarks = r.marks_obtained === '' || r.marks_obtained == null ? null : parseFloat(r.marks_obtained);
          if (finalMarks != null && finalMarks > parseFloat(subject.combined_total_marks)) {
            throw Object.assign(new Error(`Marks for ${r.subject_id} exceed limit.`), { status: 422 });
          }
        }
      }

      const { grade, isPass } = calcSubjectResult(
        finalMarks,
        parseFloat(subject.combined_total_marks),
        parseFloat(subject.combined_passing_marks),
        isAbsent,
        gradingScale
      );

      // Fetch old result for history
      const [[oldResult]] = await sequelize.query(
        `SELECT marks_obtained, theory_marks_obtained, practical_marks_obtained, is_absent 
         FROM exam_results 
         WHERE exam_id = :exam_id AND enrollment_id = :enrollment_id AND subject_id = :subject_id 
         LIMIT 1;`,
        { replacements: { exam_id, enrollment_id, subject_id: r.subject_id }, transaction: t }
      );

      await sequelize.query(`
        INSERT INTO exam_results
          (exam_id, enrollment_id, subject_id, marks_obtained, theory_marks_obtained, practical_marks_obtained, is_absent, grade, is_pass, entered_by, created_at, updated_at)
        VALUES (:exam_id, :enrollment_id, :subject_id, :marks, :theory, :practical, :isAbsent, :grade, :isPass, :enteredBy, NOW(), NOW())
        ON CONFLICT (exam_id, enrollment_id, subject_id) DO UPDATE
          SET marks_obtained = :marks, 
              theory_marks_obtained = :theory,
              practical_marks_obtained = :practical,
              is_absent = :isAbsent, 
              grade = :grade,
              is_pass = :isPass, 
              entered_by = :enteredBy, 
              updated_at = NOW();
      `, { 
        replacements: { 
          exam_id, enrollment_id, subject_id: r.subject_id, 
          marks: finalMarks, theory: theoryMarks, practical: practicalMarks,
          isAbsent, grade, isPass, enteredBy: userId 
        }, 
        transaction: t 
      });

      // Log to MarkHistory
      await MarkHistory.create({
        exam_id,
        enrollment_id,
        subject_id: r.subject_id,
        old_marks_obtained: oldResult?.marks_obtained,
        new_marks_obtained: finalMarks,
        old_theory_marks: oldResult?.theory_marks_obtained,
        new_theory_marks: theoryMarks,
        old_practical_marks: oldResult?.practical_marks_obtained,
        new_practical_marks: practicalMarks,
        old_is_absent: oldResult?.is_absent,
        new_is_absent: isAbsent,
        changed_by: userId,
        change_type: data.change_type || 'entry',
      }, { transaction: t });

      saved.push({ subject_id: r.subject_id, grade, is_pass: isPass });
    }

    return saved;
  });
}

module.exports = {
  calculateResult,
  processCompartment,
  overrideResult,
  percentageToGrade,
  calcSubjectResult,
  RESULT_RULES,
  getActiveGradingScale,
  saveStudentMarks,
};
