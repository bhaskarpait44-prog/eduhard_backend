'use strict';

const sequelize = require('../config/database');
const aiEngine = require('../utils/aiEngine');

exports.getAdminStats = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { session_id } = req.query;

    // 1. Resolve Session
    let sessionId = session_id;
    if (!sessionId || sessionId === 'null' || sessionId === 'undefined') {
      const [[currentSession]] = await sequelize.query(`
        SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
      `, { replacements: { schoolId } });
      sessionId = currentSession?.id;
    }

    if (!sessionId) return res.fail('No active session found.');
    sessionId = parseInt(sessionId);

    // 2. Total Students
    const [[studentCount]] = await sequelize.query(`
      SELECT COUNT(*)::int AS total
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId AND s.school_id = :schoolId AND e.status = 'active';
    `, { replacements: { sessionId, schoolId } });

    // 3. Today's Attendance
    const today = new Date().toISOString().slice(0, 10);
    const [[attendance]] = await sequelize.query(`
      SELECT 
        COUNT(*)::int AS total_marked,
        COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::int AS present,
        COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent,
        COUNT(*) FILTER (WHERE a.status = 'half_day')::int AS half_day
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.date = :today AND e.session_id = :sessionId AND s.school_id = :schoolId;
    `, { replacements: { today, sessionId, schoolId } });

    const totalStudents = studentCount.total || 0;
    const totalMarked = Number(attendance.total_marked || 0);
    const presentCount = Number(attendance.present || 0) + Number(attendance.half_day || 0) * 0.5;
    const attendancePercentage = totalMarked > 0 ? (presentCount / totalMarked) * 100 : 0;

    // 4. Fee Collection (Monthly Collection Ratio)
    const [[fees]] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(fp.amount), 0) AS collected,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS total_expected
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN fee_payments fp ON fp.invoice_id = fi.id
      WHERE e.session_id = :sessionId AND s.school_id = :schoolId
      AND DATE_TRUNC('month', fi.due_date::date) = DATE_TRUNC('month', CURRENT_DATE);
    `, { replacements: { sessionId, schoolId } });

    const collected = Number(fees.collected || 0);
    const totalExpected = Number(fees.total_expected || 0);
    const feePercentage = totalExpected > 0 ? (collected / totalExpected) * 100 : 0;

    // 5. Upcoming Exams
    const [[exams]] = await sequelize.query(`
      SELECT 
        COUNT(*)::int AS count,
        MIN(name) FILTER (WHERE start_date >= CURRENT_DATE) AS next_exam
      FROM exams
      WHERE session_id = :sessionId AND start_date >= CURRENT_DATE
      LIMIT 1;
    `, { replacements: { sessionId } });

    // 6. Attendance Forecast (Using aiEngine.predictValue)
    const attendanceHistory = await sequelize.query(`
      SELECT 
        date,
        (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::float / NULLIF(COUNT(e.id), 0)) * 100 AS percentage
      FROM enrollments e
      LEFT JOIN attendance a ON a.enrollment_id = e.id
      WHERE e.session_id = :sessionId AND e.status = 'active' AND a.date < CURRENT_DATE
      AND a.date >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY date
      ORDER BY date ASC;
    `, { replacements: { sessionId }, type: sequelize.QueryTypes.SELECT });

    const dataPoints = attendanceHistory.map(h => ({ value: Number(h.percentage) }));
    const predictedAttendance = aiEngine.predictValue(dataPoints, dataPoints.length);

    res.ok({
      totalStudents: totalStudents,
      attendanceToday: {
        percentage: attendancePercentage,
        present: presentCount,
        absent: attendance.absent || 0,
        total_marked: totalMarked,
        total_students: totalStudents,
        forecast: predictedAttendance ? Number(predictedAttendance.toFixed(1)) : null
      },
      feeCollection: {
        collected: collected,
        total_expected: totalExpected,
        percentage: feePercentage
      },
      upcomingExams: {
        count: exams.count,
        next: exams.next_exam
      },
      classAttendance: await sequelize.query(`
        SELECT 
          c.id,
          c.name AS class_name,
          COUNT(e.id)::int AS total,
          COUNT(a.id)::int AS total_marked,
          COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::int AS present,
          COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
          COUNT(a.id) FILTER (WHERE a.status = 'half_day')::int AS half_day
        FROM enrollments e
        JOIN classes c ON c.id = e.class_id
        LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = :today
        WHERE e.session_id = :sessionId AND e.status = 'active'
        GROUP BY c.id, c.name
        ORDER BY c.name;
      `, { replacements: { today, sessionId }, type: sequelize.QueryTypes.SELECT })
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/dashboard/admin/attendance-trend
 * Returns daily attendance percentages for the last N days.
 */
exports.getAttendanceTrend = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const days = parseInt(req.query.days) || 7;

    const trend = await sequelize.query(`
      SELECT 
        TO_CHAR(d.date, 'DD Mon') AS label,
        COALESCE(
          (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late'))::float / NULLIF(COUNT(e.id), 0)) * 100, 
          0
        ) AS value
      FROM (
        SELECT GENERATE_SERIES(CURRENT_DATE - INTERVAL '1 day' * :days, CURRENT_DATE, '1 day')::date AS date
      ) d
      CROSS JOIN (SELECT id FROM schools WHERE id = :schoolId) s
      LEFT JOIN classes c ON c.school_id = s.id
      LEFT JOIN enrollments e ON e.class_id = c.id AND e.status = 'active'
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = d.date
      GROUP BY d.date
      ORDER BY d.date ASC;
    `, { replacements: { schoolId, days: days - 1 }, type: sequelize.QueryTypes.SELECT });

    res.ok(trend.map(t => ({ label: t.label, value: Number(Number(t.value).toFixed(1)) })));
  } catch (err) { next(err); }
};
