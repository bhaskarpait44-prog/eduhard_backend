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
    
    // 1. Resolve Session
    let sessionId = req.query.session_id;
    if (!sessionId || sessionId === 'null' || sessionId === 'undefined') {
      const [[currentSession]] = await sequelize.query(`
        SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
      `, { replacements: { schoolId } });
      sessionId = currentSession?.id;
    }

    if (!sessionId) return res.fail('No active session found.');
    sessionId = parseInt(sessionId);

    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 7);

    const todayStr = today.toISOString().slice(0, 10);
    const lastWeekStr = lastWeek.toISOString().slice(0, 10);

    // 2. Fetch Attendance Data (Today vs Last Week)
    const [[attToday]] = await sequelize.query(`
      SELECT 
        COUNT(a.id)::int AS total,
        COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::int AS present
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.date = :todayStr AND s.school_id = :schoolId AND e.session_id = :sessionId;
    `, { replacements: { todayStr, schoolId, sessionId } });

    const [[attLastWeek]] = await sequelize.query(`
      SELECT 
        COUNT(a.id)::int AS total,
        COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::int AS present
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.date = :lastWeekStr AND s.school_id = :schoolId AND e.session_id = :sessionId;
    `, { replacements: { lastWeekStr, schoolId, sessionId } });

    const attTodayPct = attToday.total > 0 ? (attToday.present / attToday.total) * 100 : 0;
    const attLastWeekPct = attLastWeek.total > 0 ? (attLastWeek.present / attLastWeek.total) * 100 : 0;
    const attTrend = aiEngine.calculateTrend(attTodayPct, attLastWeekPct);

    // 3. Fetch Fee Collection (Current Month vs Last Month)
    const [[feeStats]] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(fp.amount), 0) AS collected,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS expected
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN fee_payments fp ON fp.invoice_id = fi.id
      WHERE s.school_id = :schoolId AND e.session_id = :sessionId
      AND DATE_TRUNC('month', fi.due_date::date) = DATE_TRUNC('month', CURRENT_DATE);
    `, { replacements: { schoolId, sessionId } });

    const [[prevFeeStats]] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(fp.amount), 0) AS collected,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS expected
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN fee_payments fp ON fp.invoice_id = fi.id
      WHERE s.school_id = :schoolId AND e.session_id = :sessionId
      AND DATE_TRUNC('month', fi.due_date::date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month');
    `, { replacements: { schoolId, sessionId } });

    const feeCollectionRatio = feeStats.expected > 0 ? feeStats.collected / feeStats.expected : 0;
    const prevFeeCollectionRatio = prevFeeStats.expected > 0 ? prevFeeStats.collected / prevFeeStats.expected : 0;
    const feeTrend = aiEngine.calculateTrend(feeCollectionRatio * 100, prevFeeCollectionRatio * 100);

    // 4. Detect Anomalies in Class-wise Attendance
    const classAttendance = await sequelize.query(`
      SELECT 
        c.name AS label,
        (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::float / NULLIF(COUNT(e.id), 0)) * 100 AS value
      FROM enrollments e
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = :todayStr
      WHERE e.status = 'active' AND c.school_id = :schoolId AND e.session_id = :sessionId
      GROUP BY c.id, c.name;
    `, { replacements: { todayStr, schoolId, sessionId }, type: sequelize.QueryTypes.SELECT });

    const anomalies = aiEngine.detectAnomalies(classAttendance.map(c => ({ label: c.label, value: Number(c.value) })));

    // 5. Calculate High Risk Students Count
    const [[{ highRiskCount }]] = await sequelize.query(`
      WITH student_metrics AS (
        SELECT 
          e.id,
          COALESCE((SELECT (COUNT(*) FILTER (WHERE status IN ('present', 'late'))::float / NULLIF(COUNT(*), 0)) * 100 FROM attendance WHERE enrollment_id = e.id), 100) AS att_pct,
          COALESCE((
            SELECT CASE WHEN SUM(amount_due + late_fee_amount - concession_amount) > 0 
            THEN (SUM(amount_due + late_fee_amount - concession_amount) - (SELECT COALESCE(SUM(amount), 0) FROM fee_payments fp JOIN fee_invoices fi2 ON fi2.id = fp.invoice_id WHERE fi2.enrollment_id = e.id)) / SUM(amount_due + late_fee_amount - concession_amount)
            ELSE 0 END
            FROM fee_invoices WHERE enrollment_id = e.id
          ), 0) AS fee_due_ratio,
          COALESCE((SELECT AVG(er.marks_obtained * 100 / NULLIF(es.combined_total_marks, 0)) FROM exam_results er JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id WHERE er.enrollment_id = e.id), 75) AS avg_marks
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        WHERE s.school_id = :schoolId AND e.status = 'active' AND e.session_id = :sessionId
      )
      SELECT COUNT(*)::int AS "highRiskCount"
      FROM student_metrics
      WHERE (CASE WHEN att_pct < 75 THEN (75 - att_pct) * (100.0/75.0) ELSE 0 END * 0.4) +
            (LEAST(fee_due_ratio * 100.0, 100.0) * 0.3) +
            (CASE WHEN avg_marks < 50 THEN (50 - avg_marks) * 2.0 ELSE 0 END * 0.3) > 40;
    `, { replacements: { schoolId, sessionId } });

    // 6. Attendance Forecast
    const attendanceHistory = await sequelize.query(`
      SELECT 
        (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::float / NULLIF(COUNT(e.id), 0)) * 100 AS value
      FROM enrollments e
      LEFT JOIN attendance a ON a.enrollment_id = e.id
      JOIN students s ON s.id = e.student_id
      WHERE s.school_id = :schoolId AND e.status = 'active' AND e.session_id = :sessionId AND a.date < CURRENT_DATE
      AND a.date >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY a.date
      ORDER BY a.date ASC;
    `, { replacements: { schoolId, sessionId }, type: sequelize.QueryTypes.SELECT });

    const predictedAttendance = aiEngine.predictValue(attendanceHistory.map(h => ({ value: Number(h.value) })), attendanceHistory.length);

    // 7. Recommendations
    const recommendations = aiEngine.generateRecommendations({
      attendanceTrend: attTrend,
      feeCollectionRatio: feeCollectionRatio,
      highRiskCount: highRiskCount
    });

    // 8. Build Summary
    const summary = aiEngine.buildSummaryText({
      attendance: { today: attTodayPct, trend: attTrend },
      fees: { collectionRatio: feeCollectionRatio },
      anomalies: anomalies
    });

    res.ok({
      summary,
      trends: {
        attendance: { value: attTodayPct, trend: attTrend, forecast: predictedAttendance ? Number(predictedAttendance.toFixed(1)) : null },
        fees: { value: feeCollectionRatio * 100, trend: feeTrend }
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // 1. Resolve Session
    let sessionId = req.query.session_id;
    if (!sessionId || sessionId === 'null' || sessionId === 'undefined') {
      const [[currentSession]] = await sequelize.query(`
        SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
      `, { replacements: { schoolId } });
      sessionId = currentSession?.id;
    }

    if (!sessionId) return res.fail('No active session found.');
    sessionId = parseInt(sessionId);

    // 2. Comprehensive query to get raw risk data and calculate scores in SQL
    const students = await sequelize.query(`
      WITH raw_data AS (
        SELECT 
          s.id,
          s.first_name,
          s.last_name,
          s.admission_no,
          c.name AS class_name,
          -- Attendance %
          COALESCE((SELECT (COUNT(*) FILTER (WHERE status IN ('present', 'late'))::float / NULLIF(COUNT(*), 0)) * 100 
           FROM attendance WHERE enrollment_id = e.id), 100) AS att_pct,
          -- Fee Due Ratio
          COALESCE((
            SELECT CASE WHEN SUM(amount_due + late_fee_amount - concession_amount) > 0 
            THEN (SUM(amount_due + late_fee_amount - concession_amount) - (SELECT COALESCE(SUM(amount), 0) FROM fee_payments fp JOIN fee_invoices fi2 ON fi2.id = fp.invoice_id WHERE fi2.enrollment_id = e.id)) / SUM(amount_due + late_fee_amount - concession_amount)
            ELSE 0 END
            FROM fee_invoices WHERE enrollment_id = e.id
          ), 0) AS fee_due_ratio,
          -- Academic Avg
          COALESCE((SELECT AVG(er.marks_obtained * 100 / NULLIF(es.combined_total_marks, 0)) 
           FROM exam_results er 
           JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id 
           WHERE er.enrollment_id = e.id), 75) AS avg_marks
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN classes c ON c.id = e.class_id
        WHERE s.school_id = :schoolId AND e.status = 'active' AND e.session_id = :sessionId
      ),
      scored_data AS (
        SELECT 
          *,
          -- Breakdown scores
          (CASE WHEN att_pct < 75 THEN (75 - att_pct) * (100.0/75.0) ELSE 0 END)::int AS att_risk,
          (LEAST(fee_due_ratio * 100.0, 100.0))::int AS fee_risk,
          (CASE WHEN avg_marks < 50 THEN (50 - avg_marks) * 2.0 ELSE 0 END)::int AS acad_risk
        FROM raw_data
      ),
      final_scores AS (
        SELECT 
          *,
          (att_risk * 0.4 + fee_risk * 0.3 + acad_risk * 0.3)::int AS risk_score
        FROM scored_data
      )
      SELECT 
        *,
        COUNT(*) OVER()::int AS total_count
      FROM final_scores
      WHERE risk_score > 20
      ORDER BY risk_score DESC, id ASC
      LIMIT :limit OFFSET :offset;
    `, { replacements: { schoolId, sessionId, limit, offset }, type: sequelize.QueryTypes.SELECT });

    const totalCount = students.length > 0 ? students[0].total_count : 0;

    const analyzedStudents = students.map(s => {
      // Specific recommendation per student
      let recommendation = "Maintain current performance.";
      if (s.risk_score > 70) recommendation = "Critical: Immediate parent-teacher meeting required.";
      else if (s.risk_score > 40) recommendation = "Warning: Monitor attendance and dues.";

      return {
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        admission_no: s.admission_no,
        class_name: s.class_name,
        riskScore: s.risk_score,
        breakdown: {
          attendance: s.att_risk,
          fees: s.fee_risk,
          academics: s.acad_risk
        },
        recommendation
      };
    });

    res.ok({
      students: analyzedStudents,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
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

