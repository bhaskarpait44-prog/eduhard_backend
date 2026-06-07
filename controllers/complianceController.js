'use strict';

const sequelize = require('../config/database');

exports.getReport = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { session_id } = req.query;

    // 1. Resolve Session
    let sessionId = session_id;
    if (!sessionId || sessionId === 'null' || sessionId === 'undefined' || sessionId === 'NaN') {
      const [[currentSession]] = await sequelize.query(`
        SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
      `, { replacements: { schoolId } });
      sessionId = currentSession?.id;
    }

    if (!sessionId || isNaN(parseInt(sessionId))) return res.fail('No valid active session found.');
    sessionId = parseInt(sessionId);

    // 2. Fetch Session Date Range for queries that don't directly use session_id (like audit_logs, payrolls)
    const [[sessionInfo]] = await sequelize.query(`
      SELECT id, name, start_date, end_date FROM sessions WHERE id = :sessionId;
    `, { replacements: { sessionId } });

    if (!sessionInfo) return res.fail('Session not found.');

    // 3. Find Previous Session ID for enrollment comparison
    const [[prevSession]] = await sequelize.query(`
      SELECT id FROM sessions 
      WHERE school_id = :schoolId AND end_date < :startDate 
      ORDER BY end_date DESC LIMIT 1;
    `, { replacements: { schoolId, startDate: sessionInfo.start_date } });
    const prevSessionId = prevSession?.id || null;

    // 4. Run all section queries in parallel
    const [
      enrollmentSummary,
      attendanceCompliance,
      academicPerformance,
      feeCollection,
      staffPayroll,
      libraryUtilization,
      auditGovernance,
      certificatesIssued
    ] = await Promise.all([
      // 1. ENROLLMENT SUMMARY
      (async () => {
        const [[stats]] = await sequelize.query(`
          SELECT 
            COUNT(*) FILTER (WHERE e.status = 'active')::int AS total_enrolled,
            COUNT(*) FILTER (WHERE e.joining_type = 'fresh' AND e.status = 'active')::int AS new_admissions,
            COUNT(*) FILTER (WHERE e.left_date IS NOT NULL)::int AS students_left
          FROM enrollments e
          JOIN students s ON s.id = e.student_id
          WHERE e.session_id = :sessionId AND s.school_id = :schoolId;
        `, { replacements: { sessionId, schoolId } });

        const genderBreakdown = await sequelize.query(`
          SELECT s.gender, COUNT(*)::int AS count
          FROM enrollments e
          JOIN students s ON s.id = e.student_id
          WHERE e.session_id = :sessionId AND s.school_id = :schoolId AND e.status = 'active'
          GROUP BY s.gender;
        `, { replacements: { sessionId, schoolId }, type: sequelize.QueryTypes.SELECT });

        let prevNewAdmissions = 0;
        if (prevSessionId) {
          const [[prevStats]] = await sequelize.query(`
            SELECT COUNT(*)::int AS new_admissions
            FROM enrollments e
            JOIN students s ON s.id = e.student_id
            WHERE e.session_id = :prevSessionId AND s.school_id = :schoolId AND e.joining_type = 'fresh' AND e.status = 'active';
          `, { replacements: { prevSessionId, schoolId } });
          prevNewAdmissions = prevStats?.new_admissions || 0;
        }

        const total = stats.total_enrolled || 0;
        const left = stats.students_left || 0;
        const retentionRate = total > 0 ? ((total) / (total + left)) * 100 : 100;

        return {
          total_enrolled: total,
          gender_breakdown: genderBreakdown,
          new_admissions: stats.new_admissions || 0,
          prev_new_admissions: prevNewAdmissions,
          students_left: left,
          retention_rate: retentionRate
        };
      })(),

      // 2. ATTENDANCE COMPLIANCE
      (async () => {
        const [[overall]] = await sequelize.query(`
          SELECT 
            (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late')) + COUNT(a.id) FILTER (WHERE a.status = 'half_day') * 0.5)::float / 
            NULLIF(COUNT(a.id) FILTER (WHERE a.status IN ('present', 'absent', 'late', 'half_day')), 0) * 100 AS rate
          FROM attendance a
          JOIN enrollments e ON e.id = a.enrollment_id
          JOIN students s ON s.id = e.student_id
          WHERE e.session_id = :sessionId AND s.school_id = :schoolId;
        `, { replacements: { sessionId, schoolId } });

        const classWise = await sequelize.query(`
          SELECT 
            c.name as class_name,
            (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late')) + COUNT(a.id) FILTER (WHERE a.status = 'half_day') * 0.5)::float / 
            NULLIF(COUNT(a.id) FILTER (WHERE a.status IN ('present', 'absent', 'late', 'half_day')), 0) * 100 AS rate
          FROM enrollments e
          JOIN classes c ON c.id = e.class_id
          JOIN students s ON s.id = e.student_id
          LEFT JOIN attendance a ON a.enrollment_id = e.id
          WHERE e.session_id = :sessionId AND s.school_id = :schoolId
          GROUP BY c.id, c.name;
        `, { replacements: { sessionId, schoolId }, type: sequelize.QueryTypes.SELECT });

        const [[atRisk]] = await sequelize.query(`
          WITH student_att AS (
            SELECT 
              e.student_id,
              (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late')) + COUNT(a.id) FILTER (WHERE a.status = 'half_day') * 0.5)::float / 
              NULLIF(COUNT(a.id) FILTER (WHERE a.status IN ('present', 'absent', 'late', 'half_day')), 0) AS rate
            FROM enrollments e
            JOIN students s ON s.id = e.student_id
            LEFT JOIN attendance a ON a.enrollment_id = e.id
            WHERE e.session_id = :sessionId AND s.school_id = :schoolId
            GROUP BY e.student_id
          )
          SELECT COUNT(*)::int AS count FROM student_att WHERE rate < 0.75;
        `, { replacements: { sessionId, schoolId } });

        return {
          overall_rate: overall?.rate || 0,
          class_wise: classWise,
          at_risk_count: atRisk?.count || 0
        };
      })(),

      // 3. ACADEMIC PERFORMANCE
      (async () => {
        const [[exams]] = await sequelize.query(`
          SELECT COUNT(*)::int AS count FROM exams WHERE session_id = :sessionId;
        `, { replacements: { sessionId } });

        const [[overall]] = await sequelize.query(`
          SELECT 
            COUNT(id) FILTER (WHERE is_pass = true)::float / NULLIF(COUNT(id), 0) * 100 AS pass_rate,
            AVG(marks_obtained) AS avg_marks
          FROM exam_results er
          WHERE EXISTS (
            SELECT 1 FROM exams ex WHERE ex.id = er.exam_id AND ex.session_id = :sessionId
          ) AND EXISTS (
            SELECT 1 FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.id = er.enrollment_id AND s.school_id = :schoolId
          );
        `, { replacements: { sessionId, schoolId } });

        const subjectWise = await sequelize.query(`
          SELECT 
            sub.name as subject_name,
            COUNT(er.id) FILTER (WHERE er.is_pass = true)::float / NULLIF(COUNT(er.id), 0) * 100 AS pass_rate
          FROM exam_results er
          JOIN subjects sub ON sub.id = er.subject_id
          WHERE EXISTS (
            SELECT 1 FROM exams ex WHERE ex.id = er.exam_id AND ex.session_id = :sessionId
          ) AND EXISTS (
            SELECT 1 FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.id = er.enrollment_id AND s.school_id = :schoolId
          )
          GROUP BY sub.id, sub.name;
        `, { replacements: { sessionId, schoolId }, type: sequelize.QueryTypes.SELECT });

        const gradeDist = await sequelize.query(`
          SELECT grade, COUNT(*)::int AS count
          FROM exam_results er
          WHERE grade IS NOT NULL AND EXISTS (
            SELECT 1 FROM exams ex WHERE ex.id = er.exam_id AND ex.session_id = :sessionId
          ) AND EXISTS (
            SELECT 1 FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.id = er.enrollment_id AND s.school_id = :schoolId
          )
          GROUP BY grade;
        `, { replacements: { sessionId, schoolId }, type: sequelize.QueryTypes.SELECT });

        return {
          exams_conducted: exams.count || 0,
          pass_rate: overall?.pass_rate || 0,
          avg_marks: overall?.avg_marks || 0,
          subject_wise: subjectWise,
          grade_distribution: gradeDist
        };
      })(),

      // 4. FEE COLLECTION COMPLIANCE
      (async () => {
        const [[stats]] = await sequelize.query(`
          SELECT 
            COALESCE(SUM(amount_due + late_fee_amount - concession_amount), 0) AS total_invoiced,
            COALESCE(SUM(amount_paid), 0) AS total_collected
          FROM fee_invoices fi
          JOIN enrollments e ON e.id = fi.enrollment_id
          JOIN students s ON s.id = e.student_id
          WHERE e.session_id = :sessionId AND s.school_id = :schoolId;
        `, { replacements: { sessionId, schoolId } });

        const [[defaulters]] = await sequelize.query(`
          SELECT COUNT(DISTINCT e.student_id)::int AS count,
                 COALESCE(SUM(amount_due + late_fee_amount - concession_amount - amount_paid), 0) AS outstanding
          FROM fee_invoices fi
          JOIN enrollments e ON e.id = fi.enrollment_id
          JOIN students s ON s.id = e.student_id
          WHERE e.session_id = :sessionId AND s.school_id = :schoolId
          AND (amount_due + late_fee_amount - concession_amount - amount_paid) > 0;
        `, { replacements: { sessionId, schoolId } });

        const invoiced = Number(stats.total_invoiced || 0);
        const collected = Number(stats.total_collected || 0);
        const rate = invoiced > 0 ? (collected / invoiced) * 100 : 100;

        return {
          total_invoiced: invoiced,
          total_collected: collected,
          collection_rate: rate,
          defaulter_count: defaulters.count || 0,
          outstanding_amount: defaulters.outstanding || 0
        };
      })(),

      // 5. STAFF & PAYROLL
      (async () => {
        const [[teachingStaff]] = await sequelize.query(`
          SELECT COUNT(*)::int AS count FROM users 
          WHERE school_id = :schoolId AND role = 'teacher' AND is_active = true;
        `, { replacements: { schoolId } });

        const [[nonTeachingStaff]] = await sequelize.query(`
          SELECT COUNT(*)::int AS count FROM users 
          WHERE school_id = :schoolId AND role NOT IN ('teacher', 'student', 'parent') AND is_active = true;
        `, { replacements: { schoolId } });

        const [[attendance]] = await sequelize.query(`
          SELECT 
            (COUNT(id) FILTER (WHERE status IN ('present', 'late')) + COUNT(id) FILTER (WHERE status = 'half_day') * 0.5)::float / 
            NULLIF(COUNT(id) FILTER (WHERE status IN ('present', 'absent', 'late', 'half_day')), 0) * 100 AS rate
          FROM staff_attendance
          WHERE school_id = :schoolId AND date BETWEEN :start AND :end;
        `, { replacements: { schoolId, start: sessionInfo.start_date, end: sessionInfo.end_date } });

        const [[payroll]] = await sequelize.query(`
          SELECT 
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'paid')::int AS paid
          FROM payrolls
          WHERE school_id = :schoolId AND (
            (year > EXTRACT(YEAR FROM :start::date)) OR 
            (year = EXTRACT(YEAR FROM :start::date) AND month >= EXTRACT(MONTH FROM :start::date))
          ) AND (
            (year < EXTRACT(YEAR FROM :end::date)) OR 
            (year = EXTRACT(YEAR FROM :end::date) AND month <= EXTRACT(MONTH FROM :end::date))
          );
        `, { replacements: { schoolId, start: sessionInfo.start_date, end: sessionInfo.end_date } });

        const totalPayrolls = payroll.total || 0;
        const paidPayrolls = payroll.paid || 0;
        const payrollRate = totalPayrolls > 0 ? (paidPayrolls / totalPayrolls) * 100 : 100;

        return {
          teaching_staff_count: teachingStaff.count || 0,
          non_teaching_staff_count: nonTeachingStaff.count || 0,
          staff_attendance_rate: attendance?.rate || 0,
          payroll_disbursement_rate: payrollRate
        };
      })(),

      // 6. LIBRARY UTILIZATION
      (async () => {
        const [[books]] = await sequelize.query(`
          SELECT COUNT(*)::int AS count FROM library_books WHERE school_id = :schoolId;
        `, { replacements: { schoolId } });

        const [[issues]] = await sequelize.query(`
          SELECT 
            COUNT(*)::int AS total_issues,
            COUNT(DISTINCT borrower_id) FILTER (WHERE borrower_type = 'student' AND status = 'issued')::int AS active_borrowers,
            COUNT(*) FILTER (WHERE status = 'overdue' OR (status = 'issued' AND due_date < CURRENT_DATE))::int AS overdue_count
          FROM library_issues
          WHERE school_id = :schoolId AND issue_date BETWEEN :start AND :end;
        `, { replacements: { schoolId, start: sessionInfo.start_date, end: sessionInfo.end_date } });

        return {
          total_books: books.count || 0,
          total_issues: issues.total_issues || 0,
          active_borrowers: issues.active_borrowers || 0,
          overdue_books: issues.overdue_count || 0
        };
      })(),

      // 7. AUDIT & GOVERNANCE
      (async () => {
        const [[stats]] = await sequelize.query(`
          SELECT 
            COUNT(*)::int AS total_actions,
            COUNT(DISTINCT changed_by)::int AS unique_admins
          FROM audit_logs
          WHERE school_id = :schoolId AND created_at BETWEEN :start AND :end;
        `, { replacements: { schoolId, start: sessionInfo.start_date, end: sessionInfo.end_date } });

        const [[mostModified]] = await sequelize.query(`
          SELECT table_name, COUNT(*)::int AS count
          FROM audit_logs
          WHERE school_id = :schoolId AND created_at BETWEEN :start AND :end
          GROUP BY table_name
          ORDER BY count DESC
          LIMIT 1;
        `, { replacements: { schoolId, start: sessionInfo.start_date, end: sessionInfo.end_date } });

        return {
          total_admin_actions: stats.total_actions || 0,
          unique_admins: stats.unique_admins || 0,
          most_modified_table: mostModified?.table_name || 'N/A'
        };
      })(),

      // 8. CERTIFICATES ISSUED
      (async () => {
        const [[certs]] = await sequelize.query(`
          SELECT COUNT(*)::int AS count FROM certificates
          WHERE school_id = :schoolId AND issued_date BETWEEN :start AND :end;
        `, { replacements: { schoolId, start: sessionInfo.start_date, end: sessionInfo.end_date } });

        return {
          count: certs.count || 0
        };
      })()
    ]);

    res.ok({
      session: {
        id: sessionId,
        name: sessionInfo.name,
        start_date: sessionInfo.start_date,
        end_date: sessionInfo.end_date
      },
      enrollment: enrollmentSummary,
      attendance: attendanceCompliance,
      academic: academicPerformance,
      fee: feeCollection,
      staff: staffPayroll,
      library: libraryUtilization,
      audit: auditGovernance,
      certificates: certificatesIssued
    });
  } catch (err) {
    next(err);
  }
};
