'use strict';

const sequelize = require('../config/database');

exports.getAdminStats = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { session_id } = req.query;

    // 1. Resolve Session
    let sessionId = session_id;
    if (!sessionId) {
      const [[currentSession]] = await sequelize.query(`
        SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
      `, { replacements: { schoolId } });
      sessionId = currentSession?.id;
    }

    if (!sessionId) return res.fail('No active session found.');

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
        COUNT(*) FILTER (WHERE status IN ('present', 'late'))::int AS present,
        COUNT(*) FILTER (WHERE status = 'absent')::int AS absent,
        COUNT(*) FILTER (WHERE status = 'half_day')::int AS half_day
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.date = :today AND e.session_id = :sessionId AND s.school_id = :schoolId;
    `, { replacements: { today, sessionId, schoolId } });

    const totalStudents = studentCount.total;
    const presentCount = (attendance.present || 0) + (attendance.half_day || 0) * 0.5;
    const attendancePercentage = totalStudents > 0 ? (presentCount / totalStudents) * 100 : 0;

    // 4. Fee Collection (Monthly)
    const [[fees]] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(fp.amount), 0) AS collected,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS total_expected
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN fee_payments fp ON fp.invoice_id = fi.id 
        AND DATE_TRUNC('month', fp.payment_date::date) = DATE_TRUNC('month', CURRENT_DATE)
      WHERE e.session_id = :sessionId AND s.school_id = :schoolId;
    `, { replacements: { sessionId, schoolId } });

    // 5. Upcoming Exams
    const [[exams]] = await sequelize.query(`
      SELECT 
        COUNT(*)::int AS count,
        MIN(name) FILTER (WHERE start_date >= CURRENT_DATE) AS next_exam
      FROM exams
      WHERE session_id = :sessionId AND start_date >= CURRENT_DATE
      LIMIT 1;
    `, { replacements: { sessionId } });

    res.ok({
      totalStudents: totalStudents,
      attendanceToday: {
        percentage: attendancePercentage,
        present: presentCount,
        absent: attendance.absent || 0
      },
      feeCollection: {
        collected: fees.collected,
        total_expected: fees.total_expected,
        percentage: fees.total_expected > 0 ? (fees.collected / fees.total_expected) * 100 : 0
      },
      upcomingExams: {
        count: exams.count,
        next: exams.next_exam
      },
      classAttendance: await sequelize.query(`
        SELECT 
          c.name AS class_name,
          COUNT(e.id)::int AS total,
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
