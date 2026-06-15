'use strict';

const sequelize = require('../config/database');
const aiService = require('../utils/aiService');

exports.getDashboardSummary = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const today = new Date().toISOString().slice(0, 10);
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfWeekStr = startOfWeek.toISOString().slice(0, 10);

    // 1. Resolve Session
    const [[currentSession]] = await sequelize.query(`
      SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
    `, { replacements: { schoolId } });
    const sessionId = currentSession?.id;

    if (!sessionId) return res.fail('No active session found.');

    // 2. Aggregate Data for AI
    const data = {};

    // A. Attendance (Today & Weekly)
    const [[attendanceStats]] = await sequelize.query(`
      SELECT 
        COUNT(a.id)::int AS total_marked,
        COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::int AS present,
        COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS absent
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.date = :today AND s.school_id = :schoolId;
    `, { replacements: { today, schoolId } });

    const [[weeklyAttendance]] = await sequelize.query(`
      SELECT 
        AVG(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) * 100 AS avg_percentage
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.date >= :startOfWeekStr AND s.school_id = :schoolId;
    `, { replacements: { startOfWeekStr, schoolId } });

    data.attendance = {
      today: {
        present: attendanceStats.present,
        absent: attendanceStats.absent,
        percentage: attendanceStats.total_marked > 0 ? (attendanceStats.present / attendanceStats.total_marked) * 100 : 0
      },
      weekly_avg: parseFloat(weeklyAttendance.avg_percentage || 0).toFixed(2)
    };

    // B. Fees (Current Month)
    const [[feeStats]] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(fp.amount), 0) AS collected,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS expected
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN fee_payments fp ON fp.invoice_id = fi.id
      WHERE e.session_id = :sessionId AND s.school_id = :schoolId
      AND DATE_TRUNC('month', fi.due_date) = DATE_TRUNC('month', CURRENT_DATE);
    `, { replacements: { sessionId, schoolId } });

    const [[defaulters]] = await sequelize.query(`
      SELECT COUNT(DISTINCT e.id)::int AS count
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId AND s.school_id = :schoolId
      AND fi.due_date < CURRENT_DATE
      AND (fi.amount_due + fi.late_fee_amount - fi.concession_amount) > (
        SELECT COALESCE(SUM(amount), 0) FROM fee_payments WHERE invoice_id = fi.id
      );
    `, { replacements: { sessionId, schoolId } });

    data.fees = {
      monthly_collected: feeStats.collected,
      monthly_expected: feeStats.expected,
      collection_percentage: feeStats.expected > 0 ? (feeStats.collected / feeStats.expected) * 100 : 0,
      defaulter_count: defaulters.count
    };

    // C. Exams (Upcoming)
    data.upcoming_exams = await sequelize.query(`
      SELECT name, start_date, end_date
      FROM exams
      WHERE session_id = :sessionId AND start_date >= CURRENT_DATE
      ORDER BY start_date ASC
      LIMIT 3;
    `, { replacements: { sessionId }, type: sequelize.QueryTypes.SELECT });

    // D. Staff Attendance (Today)
    const [[staffStats]] = await sequelize.query(`
      SELECT 
        COUNT(sa.id)::int AS total_marked,
        COUNT(sa.id) FILTER (WHERE sa.status = 'present')::int AS present,
        COUNT(sa.id) FILTER (WHERE sa.status = 'absent')::int AS absent
      FROM staff_attendance sa
      JOIN teachers t ON t.id = sa.teacher_id
      WHERE sa.date = :today AND t.school_id = :schoolId;
    `, { replacements: { today, schoolId } });

    data.staff = {
      today_present: staffStats.present,
      today_absent: staffStats.absent,
      percentage: staffStats.total_marked > 0 ? (staffStats.present / staffStats.total_marked) * 100 : 0
    };

    // 3. Generate AI Summary
    const summary = await aiService.generateAnalysis(data);

    res.ok({
      summary,
      raw_data: data // Optionally return raw data for charts
    });
  } catch (err) {
    next(err);
  }
};
