'use strict';

const sequelize = require('../config/database');

/**
 * Mark a student as left.
 * Updates student status and closes active enrollment.
 */
exports.markAsLeft = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { left_date, leaving_reason, leaving_remarks } = req.body;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT id FROM students WHERE id = :id AND school_id = :schoolId
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    const [[activeEnrollment]] = await sequelize.query(`
      SELECT id FROM enrollments WHERE student_id = :id AND status = 'active'
    `, { replacements: { id } });

    if (!activeEnrollment) {
      return res.fail('Student has no active enrollment. Cannot mark as left.', [], 400);
    }

    const finalLeftDate = left_date || new Date().toISOString().split('T')[0];

    await sequelize.query(`
      UPDATE enrollments
      SET status = 'inactive',
          left_date = :finalLeftDate,
          leaving_type = 'left',
          updated_at = NOW()
      WHERE id = :enrollmentId;
    `, { replacements: { enrollmentId: activeEnrollment.id, finalLeftDate } });

    await sequelize.query(`
      UPDATE students
      SET status = 'left',
          left_date = :finalLeftDate,
          leaving_reason = :leaving_reason,
          leaving_remarks = :leaving_remarks,
          is_active = false,
          updated_at = NOW()
      WHERE id = :id;
    `, { replacements: { id, finalLeftDate, leaving_reason, leaving_remarks } });

    res.ok({}, 'Student marked as left successfully.');
  } catch (err) { next(err); }
};

exports.markAsGraduated = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { graduated_date, remarks } = req.body;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT id, status FROM students WHERE id = :id AND school_id = :schoolId
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);
    if (student.status !== 'active') {
      return res.fail(`Cannot mark as graduated. Student status is already '${student.status}'.`, [], 400);
    }

    const [[activeEnrollment]] = await sequelize.query(`
      SELECT id FROM enrollments WHERE student_id = :id AND status = 'active'
    `, { replacements: { id } });

    if (!activeEnrollment) {
      return res.fail('Student has no active enrollment. Cannot mark as graduated.', [], 400);
    }

    const finalDate = graduated_date || new Date().toISOString().split('T')[0];

    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        UPDATE enrollments
        SET status = 'inactive',
            left_date = :finalDate,
            leaving_type = 'graduated',
            updated_at = NOW()
        WHERE id = :enrollmentId;
      `, { replacements: { enrollmentId: activeEnrollment.id, finalDate }, transaction: t });

      await sequelize.query(`
        UPDATE students
        SET status = 'graduated',
            left_date = :finalDate,
            leaving_remarks = :remarks,
            is_active = false,
            updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id, finalDate, remarks }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('students', :id, 'status', 'active', 'graduated',
           :changedBy, 'Student marked as graduated manually', :ip, :device, NOW())
      `, { replacements: {
        id,
        changedBy: req.user.id,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });
    });

    res.ok({}, 'Student marked as graduated successfully.');
  } catch (err) { next(err); }
};

exports.getLeftStudents = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { 
      page = 1, 
      perPage = 20, 
      search = '', 
      leaving_reason = '', 
      class_id = '', 
      session_id = '',
      from_date = '',
      to_date = ''
    } = req.query;

    const limitNum = parseInt(perPage, 10) || 20;
    const offsetNum = (parseInt(page, 10) - 1) * limitNum;

    const replacements = { 
      schoolId, 
      search: `%${search}%`,
      leaving_reason: leaving_reason || null,
      classId: class_id ? parseInt(class_id, 10) : null,
      sessionId: session_id ? parseInt(session_id, 10) : null,
      fromDate: from_date || null,
      toDate: to_date || null,
      limit: limitNum,
      offset: offsetNum
    };

    const baseQuery = `
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.leaving_type = 'left'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN sessions sess ON sess.id = e.session_id
      WHERE s.school_id = :schoolId 
        AND s.status = 'left'
        AND s.is_deleted = false
        AND (s.first_name ILIKE :search OR s.last_name ILIKE :search OR s.admission_no ILIKE :search)
        AND (:leaving_reason IS NULL OR s.leaving_reason = :leaving_reason)
        AND (:classId IS NULL OR e.class_id = :classId)
        AND (:sessionId IS NULL OR e.session_id = :sessionId)
        AND (:fromDate IS NULL OR s.left_date >= CAST(:fromDate AS DATE))
        AND (:toDate IS NULL OR s.left_date <= CAST(:toDate AS DATE))
    `;

    const [[{ count }]] = await sequelize.query(`SELECT COUNT(DISTINCT s.id)::int AS count ${baseQuery}`, { replacements });
    
    const [students] = await sequelize.query(`
      SELECT DISTINCT ON (s.id)
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url, 
        s.left_date AS student_left_date, s.leaving_reason,
        c.name AS class_name, sec.name AS section_name, sess.name AS session_name
      ${baseQuery}
      ORDER BY s.id, e.left_date DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    res.ok({
      students: students.map(s => ({ ...s, left_date: s.student_left_date })),
      pagination: {
        total: parseInt(count, 10),
        page: parseInt(page, 10),
        perPage: limitNum,
        totalPages: Math.max(Math.ceil(count / limitNum), 1)
      }
    }, 'Left students retrieved.');
  } catch (err) { next(err); }
};

exports.getGraduatedStudents = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { 
      page = 1, 
      perPage = 20, 
      search = '', 
      class_id = '', 
      session_id = '' 
    } = req.query;

    const limitNum = parseInt(perPage, 10) || 20;
    const offsetNum = (parseInt(page, 10) - 1) * limitNum;

    const replacements = { 
      schoolId, 
      search: `%${search}%`,
      classId: class_id ? parseInt(class_id, 10) : null,
      sessionId: session_id ? parseInt(session_id, 10) : null,
      limit: limitNum,
      offset: offsetNum
    };

    const baseQuery = `
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      JOIN enrollments e ON e.student_id = s.id AND e.leaving_type = 'graduated'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN sessions sess ON sess.id = e.session_id
      LEFT JOIN student_results sr ON sr.enrollment_id = e.id
      WHERE s.school_id = :schoolId 
        AND s.status = 'graduated'
        AND s.is_deleted = false
        AND (s.first_name ILIKE :search OR s.last_name ILIKE :search OR s.admission_no ILIKE :search)
        AND (:classId IS NULL OR e.class_id = :classId)
        AND (:sessionId IS NULL OR e.session_id = :sessionId)
    `;

    const [[{ count }]] = await sequelize.query(`SELECT COUNT(DISTINCT s.id)::int AS count ${baseQuery}`, { replacements });
    
    const [students] = await sequelize.query(`
      SELECT DISTINCT ON (s.id)
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url,
        c.name AS class_name, sec.name AS section_name, sess.name AS session_name,
        sr.percentage, sr.grade
      ${baseQuery}
      ORDER BY s.id, e.left_date DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    res.ok({
      students,
      pagination: {
        total: parseInt(count, 10),
        page: parseInt(page, 10),
        perPage: limitNum,
        totalPages: Math.max(Math.ceil(count / limitNum), 1)
      }
    }, 'Graduated students retrieved.');
  } catch (err) { next(err); }
};

exports.getEnrollmentHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [history] = await sequelize.query(`
      SELECT 
        e.id, e.joined_date, e.left_date, e.joining_type, e.leaving_type, e.status, e.roll_number,
        c.name AS class_name, sec.name AS section_name, sess.name AS session_name,
        sr.result, sr.percentage, sr.grade
      FROM enrollments e
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      LEFT JOIN student_results sr ON sr.enrollment_id = e.id
      JOIN students s ON s.id = e.student_id
      WHERE e.student_id = :id AND s.school_id = :schoolId
      ORDER BY e.joined_date DESC;
    `, { replacements: { id, schoolId } });

    res.ok(history, 'Enrollment history retrieved.');
  } catch (err) { next(err); }
};

exports.readmitStudent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { session_id, class_id, section_id, joined_date, roll_number } = req.body;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT id FROM students WHERE id = :id AND school_id = :schoolId
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    const [[lastEnrollment]] = await sequelize.query(`
      SELECT id FROM enrollments WHERE student_id = :id ORDER BY joined_date DESC LIMIT 1
    `, { replacements: { id } });

    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        INSERT INTO enrollments (
          student_id, session_id, class_id, section_id, roll_number, 
          joined_date, joining_type, status, previous_enrollment_id, created_at, updated_at
        ) VALUES (
          :id, :session_id, :class_id, :section_id, :roll_number, 
          :joined_date, 'rejoined', 'active', :prevId, NOW(), NOW()
        )
      `, { replacements: { 
        id, session_id, class_id, section_id, roll_number, 
        joined_date: joined_date || new Date().toISOString().split('T')[0],
        prevId: lastEnrollment ? lastEnrollment.id : null
      }, transaction: t });

      const oldStatus = student.status || 'left';

      await sequelize.query(`
        UPDATE students
        SET status = 'active',
            left_date = null,
            leaving_reason = null,
            leaving_remarks = null,
            is_active = true,
            updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('students', :id, 'status', :oldStatus, 'active',
           :changedBy, 'Student re-admitted', :ip, :device, NOW())
      `, { replacements: {
        id,
        oldStatus,
        changedBy: req.user.id,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });
    });

    res.ok({}, 'Student re-admitted successfully.');
  } catch (err) { next(err); }
};

exports.getLeavingSummary = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { session_id } = req.query;

    const replacements = { 
      schoolId, 
      sessionId: session_id ? parseInt(session_id, 10) : null 
    };

    const [[stats]] = await sequelize.query(`
      SELECT
        COALESCE((SELECT COUNT(*)::int FROM students WHERE school_id = :schoolId AND status = 'active' AND is_deleted = false), 0) AS total_active,
        COALESCE((SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.school_id = :schoolId AND (:sessionId IS NULL OR e.session_id = :sessionId) AND e.leaving_type = 'left'), 0) AS left_this_session,
        COALESCE((SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.school_id = :schoolId AND (:sessionId IS NULL OR e.session_id = :sessionId) AND e.leaving_type = 'graduated'), 0) AS graduated_this_session,
        COALESCE((SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.school_id = :schoolId AND (:sessionId IS NULL OR e.session_id = :sessionId) AND e.joining_type = 'rejoined'), 0) AS readmissions_this_session
    `, { replacements });

    res.ok(stats || { total_active: 0, left_this_session: 0, graduated_this_session: 0, readmissions_this_session: 0 }, 'Leaving summary retrieved.');
  } catch (err) { next(err); }
};
