'use strict';

const sequelize = require('../config/database');
const aiEngine = require('../utils/aiEngine');

/**
 * GET /api/dashboard/ai-insights
 * Returns aggregated insights for the admin dashboard.
 */
exports.getDashboardInsights = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 7);

    const todayStr = today.toISOString().slice(0, 10);
    const lastWeekStr = lastWeek.toISOString().slice(0, 10);

    // 1. Fetch Attendance Data (Today vs Last Week)
    const [[attToday]] = await sequelize.query(`
      SELECT 
        COUNT(a.id)::int AS total,
        COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::int AS present
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.date = :todayStr AND s.school_id = :schoolId;
    `, { replacements: { todayStr, schoolId } });

    const [[attLastWeek]] = await sequelize.query(`
      SELECT 
        COUNT(a.id)::int AS total,
        COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::int AS present
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.date = :lastWeekStr AND s.school_id = :schoolId;
    `, { replacements: { lastWeekStr, schoolId } });

    const attTodayPct = attToday.total > 0 ? (attToday.present / attToday.total) * 100 : 0;
    const attLastWeekPct = attLastWeek.total > 0 ? (attLastWeek.present / attLastWeek.total) * 100 : 0;
    const attTrend = aiEngine.calculateTrend(attTodayPct, attLastWeekPct);

    // 2. Fetch Fee Collection (Current Month)
    const [[feeStats]] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(fp.amount), 0) AS collected,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS expected
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN fee_payments fp ON fp.invoice_id = fi.id
      WHERE s.school_id = :schoolId
      AND DATE_TRUNC('month', fi.due_date::date) = DATE_TRUNC('month', CURRENT_DATE);
    `, { replacements: { schoolId } });

    const feeCollectionRatio = feeStats.expected > 0 ? feeStats.collected / feeStats.expected : 0;

    // 3. Detect Anomalies in Class-wise Attendance
    const classAttendance = await sequelize.query(`
      SELECT 
        c.name AS label,
        (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::float / NULLIF(COUNT(e.id), 0)) * 100 AS value
      FROM enrollments e
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = :todayStr
      WHERE e.status = 'active' AND c.school_id = :schoolId
      GROUP BY c.id, c.name;
    `, { replacements: { todayStr, schoolId }, type: sequelize.QueryTypes.SELECT });

    const anomalies = aiEngine.detectAnomalies(classAttendance.map(c => ({ label: c.label, value: Number(c.value) })));

    // 4. Recommendations
    const recommendations = aiEngine.generateRecommendations({
      attendanceTrend: attTrend,
      feeCollectionRatio: feeCollectionRatio,
      highRiskCount: 0 // Placeholder, computed in next step or separate endpoint
    });

    // 5. Build Summary
    const summary = aiEngine.buildSummaryText({
      attendance: { today: attTodayPct, trend: attTrend },
      fees: { collectionRatio: feeCollectionRatio },
      anomalies: anomalies
    });

    res.ok({
      summary,
      trends: {
        attendance: { value: attTodayPct, trend: attTrend },
        fees: { value: feeCollectionRatio * 100, trend: 0 } // Trend for fees could be added similarly
      },
      anomalies,
      recommendations
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/dashboard/ai-risk-students
 * Identifies at-risk students based on attendance, fees, and marks.
 */
exports.getStudentRiskAnalysis = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    // Comprehensive query to get raw risk data
    const students = await sequelize.query(`
      SELECT 
        s.id,
        s.first_name,
        s.last_name,
        s.admission_no,
        c.name AS class_name,
        -- Attendance %
        (SELECT (COUNT(*) FILTER (WHERE status IN ('present', 'late'))::float / NULLIF(COUNT(*), 0)) * 100 
         FROM attendance WHERE enrollment_id = e.id) AS att_pct,
        -- Fee Due Ratio
        (SELECT COALESCE(SUM(amount_due + late_fee_amount - concession_amount), 0) 
         FROM fee_invoices WHERE enrollment_id = e.id) AS total_due,
        (SELECT COALESCE(SUM(amount), 0) 
         FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id WHERE fi.enrollment_id = e.id) AS total_paid,
        -- Academic Avg (Placeholder for latest exam)
        (SELECT AVG(er.marks_obtained * 100 / NULLIF(es.combined_total_marks, 0)) 
         FROM exam_results er 
         JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id 
         WHERE er.enrollment_id = e.id) AS avg_marks
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      WHERE s.school_id = :schoolId AND e.status = 'active'
      LIMIT 100; -- Limit for performance, real implementation might use pagination
    `, { replacements: { schoolId }, type: sequelize.QueryTypes.SELECT });

    const analyzedStudents = students.map(s => {
      const attPct = Number(s.att_pct || 100);
      const totalDue = Number(s.total_due || 0);
      const totalPaid = Number(s.total_paid || 0);
      const feeDueRatio = totalDue > 0 ? (totalDue - totalPaid) / totalDue : 0;
      const avgMarks = Number(s.avg_marks || 75);

      const risk = aiEngine.calculateStudentRisk({
        attendancePct: attPct,
        feeDueRatio: feeDueRatio,
        avgMarks: avgMarks
      });

      // Specific recommendation per student
      let recommendation = "Maintain current performance.";
      if (risk.score > 70) recommendation = "Critical: Immediate parent-teacher meeting required.";
      else if (risk.score > 40) recommendation = "Warning: Monitor attendance and dues.";

      return {
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        admission_no: s.admission_no,
        class_name: s.class_name,
        riskScore: risk.score,
        breakdown: risk.breakdown,
        recommendation
      };
    });

    // Sort by risk score descending
    analyzedStudents.sort((a, b) => b.riskScore - a.riskScore);

    res.ok(analyzedStudents.filter(s => s.riskScore > 20)); // Only return those with some risk
  } catch (err) { next(err); }
};

/**
 * GET /api/analytics/exams/:id/ai-insights
 * Provides comparative and predictive insights for a specific exam.
 */
exports.getExamInsights = async (req, res, next) => {
  try {
    const examId = req.params.id;

    // 1. Fetch Subject-wise performance
    const subjects = await sequelize.query(`
      SELECT 
        sub.name AS label,
        AVG(er.marks_obtained * 100 / NULLIF(es.combined_total_marks, 0))::float AS value
      FROM exam_results er
      JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id
      JOIN subjects sub ON sub.id = es.subject_id
      WHERE es.exam_id = :examId
      GROUP BY sub.id, sub.name;
    `, { replacements: { examId }, type: sequelize.QueryTypes.SELECT });

    // 2. Anomaly detection (which subjects performed unusually poor/good)
    const anomalies = aiEngine.detectAnomalies(subjects.map(s => ({ label: s.label, value: Number(s.value) })));

    // 3. Improvement detection (compare with previous exam in same session)
    const [[examInfo]] = await sequelize.query(`SELECT session_id, start_date FROM exams WHERE id = :examId`, { replacements: { examId } });
    
    const [[prevExam]] = await sequelize.query(`
      SELECT id FROM exams 
      WHERE session_id = :sessionId AND start_date < :startDate 
      ORDER BY start_date DESC LIMIT 1
    `, { replacements: { sessionId: examInfo.session_id, startDate: examInfo.start_date } });

    let improvement = null;
    if (prevExam) {
      const [[currAvg]] = await sequelize.query(`
        SELECT AVG(er.marks_obtained * 100 / NULLIF(es.combined_total_marks, 0)) AS avg 
        FROM exam_results er 
        JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id 
        WHERE es.exam_id = :examId
      `, { replacements: { examId } });
      
      const [[prevAvg]] = await sequelize.query(`
        SELECT AVG(er.marks_obtained * 100 / NULLIF(es.combined_total_marks, 0)) AS avg 
        FROM exam_results er 
        JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id 
        WHERE es.exam_id = :prevExamId
      `, { replacements: { prevExamId: prevExam.id } });

      improvement = aiEngine.calculateTrend(Number(currAvg.avg), Number(prevAvg.avg));
    }

    res.ok({
      subjectPerformance: subjects,
      anomalies,
      improvement,
      recommendation: improvement < 0 ? "Performance decline detected. Review subject-wise teaching plans." : "Steady improvement observed."
    });
  } catch (err) { next(err); }
};

