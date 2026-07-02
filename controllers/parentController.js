'use strict';

const sequelize = require('../config/database');
const { getAttendancePercent } = require('../utils/attendanceCalculator');

exports.getWards = async (req, res, next) => {
  try {
    const parentEmail = req.user.email;
    const schoolId = req.user.school_id;

    const [wards] = await sequelize.query(`
      SELECT 
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url,
        e.id AS enrollment_id, e.class_id, e.section_id, e.roll_number,
        c.name AS class_name, sec.name AS section_name
      FROM students s
      JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      WHERE LOWER(sp.parent_email) = LOWER(:parentEmail) AND s.school_id = :schoolId AND s.is_deleted = false
    `, { replacements: { parentEmail, schoolId } });

    res.ok(wards);
  } catch (err) { next(err); }
};

exports.getWardAttendance = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const parentEmail = req.user.email;
    const schoolId = req.user.school_id;

    // Verify ownership and get active enrollment ID
    const [[isValid]] = await sequelize.query(`
      SELECT s.id, e.id AS enrollment_id
      FROM students s 
      JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      WHERE s.id = :student_id AND LOWER(sp.parent_email) = LOWER(:parentEmail) AND s.school_id = :schoolId AND s.is_deleted = false
    `, { replacements: { student_id, parentEmail, schoolId } });

    if (!isValid) return res.fail('Unauthorized access to student record.', [], 403);

    if (!isValid.enrollment_id) {
      return res.ok({ records: [], summary: null }, 'No active enrollment found for this ward.');
    }

    const [attendance] = await sequelize.query(`
      SELECT a.date, a.status, a.override_reason AS remarks
      FROM attendance a
      WHERE a.enrollment_id = :enrollmentId
      ORDER BY a.date DESC
      LIMIT 60;
    `, { replacements: { enrollmentId: isValid.enrollment_id } });

    const summary = await getAttendancePercent(isValid.enrollment_id);

    res.ok({
      records: attendance,
      summary
    });
  } catch (err) { next(err); }
};

exports.getWardFees = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const parentEmail = req.user.email;
    const schoolId = req.user.school_id;

    // Verify ownership
    const [[isValid]] = await sequelize.query(`
      SELECT s.id 
      FROM students s 
      JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      WHERE s.id = :student_id AND LOWER(sp.parent_email) = LOWER(:parentEmail) AND s.school_id = :schoolId
    `, { replacements: { student_id, parentEmail, schoolId } });

    if (!isValid) return res.fail('Unauthorized access to student record.', [], 403);

    const [fees] = await sequelize.query(`
      SELECT f.*, fs.name AS fee_name
      FROM fee_invoices f
      JOIN enrollments e ON e.id = f.enrollment_id
      JOIN fee_structures fs ON fs.id = f.fee_structure_id
      WHERE e.student_id = :student_id
      ORDER BY f.due_date DESC;
    `, { replacements: { student_id } });

    res.ok(fees);
  } catch (err) { next(err); }
};

exports.getWardResults = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const parentEmail = req.user.email;
    const schoolId = req.user.school_id;

    // Verify ownership
    const [[isValid]] = await sequelize.query(`
      SELECT s.id 
      FROM students s 
      JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      WHERE s.id = :student_id AND LOWER(sp.parent_email) = LOWER(:parentEmail) AND s.school_id = :schoolId
    `, { replacements: { student_id, parentEmail, schoolId } });

    if (!isValid) return res.fail('Unauthorized access to student record.', [], 403);

    const [results] = await sequelize.query(`
      SELECT sr.*, s.name AS session_name 
      FROM student_results sr
      JOIN enrollments e ON e.id = sr.enrollment_id
      JOIN sessions s ON s.id = sr.session_id
      WHERE e.student_id = :student_id AND sr.release_result = true
      ORDER BY s.start_date DESC;
    `, { replacements: { student_id } });

    res.ok(results);
  } catch (err) { next(err); }
};

exports.getWardHomework = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const parentEmail = req.user.email;
    const schoolId = req.user.school_id;

    // Verify ownership and get active enrollment
    const [[isValid]] = await sequelize.query(`
      SELECT s.id, e.id AS enrollment_id, e.class_id, e.section_id
      FROM students s 
      JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      WHERE s.id = :student_id AND LOWER(sp.parent_email) = LOWER(:parentEmail) AND s.school_id = :schoolId
    `, { replacements: { student_id, parentEmail, schoolId } });

    if (!isValid) return res.fail('Unauthorized access to student record.', [], 403);
    if (!isValid.enrollment_id) return res.ok([], 'Student is not currently enrolled in an active section.');

    const [homework] = await sequelize.query(`
      SELECT h.*, s.name AS subject_name, u.name AS teacher_name
      FROM homework h
      JOIN subjects s ON s.id = h.subject_id
      JOIN users u ON u.id = h.created_by
      WHERE h.class_id = :classId
        AND h.section_id = :sectionId
        AND h.status = 'active'
      ORDER BY h.due_date DESC;
    `, { replacements: { classId: isValid.class_id, sectionId: isValid.section_id } });

    res.ok(homework);
  } catch (err) { next(err); }
};

exports.getWardCalendar = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const { month, year, session_id } = req.query;
    const parentEmail = req.user.email;
    const schoolId = req.user.school_id;

    if (!session_id) return res.fail('session_id is required');

    // Verify ownership and get student class
    const [[student]] = await sequelize.query(`
      SELECT s.id, e.class_id
      FROM students s 
      JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      WHERE s.id = :student_id AND LOWER(sp.parent_email) = LOWER(:parentEmail) AND s.school_id = :schoolId
    `, { replacements: { student_id, parentEmail, schoolId } });

    if (!student) return res.fail('Unauthorized access to student record.', [], 403);

    let query = `
      SELECT ae.*, c.name as target_class_name, false as is_readonly
      FROM academic_events ae
      LEFT JOIN classes c ON c.id = ae.target_class_id
      WHERE ae.school_id = :schoolId 
        AND ae.session_id = :sessionId
        AND ae.is_published = true
        AND (
          -- Global events for parents
          ae.audience IN ('everyone', 'parents')
          OR 
          -- Events targeted at students (which parents should see) AND matching class if restricted
          (ae.audience = 'students' AND (ae.target_class_id IS NULL OR ae.target_class_id = :classId))
        )
    `;
    const replacements = { 
      schoolId, 
      sessionId: session_id,
      classId: student.class_id
    };

    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM ae.start_date) = :month AND EXTRACT(YEAR FROM ae.start_date) = :year`;
      replacements.month = month;
      replacements.year = year;
    }

    // Include session holidays
    let holidaysQuery = `
      SELECT 
        id, NULL as school_id, session_id, name as title, NULL as description, 'holiday' as event_type, 
        holiday_date as start_date, holiday_date as end_date, NULL as start_time, NULL as end_time,
        true as is_all_day, 'everyone' as audience, NULL as target_class_id, '#16a34a' as color,
        true as is_published, false as notify_on_publish, NULL as created_by, NULL as updated_by,
        created_at, created_at as updated_at, NULL as target_class_name, true as is_readonly
      FROM session_holidays
      WHERE session_id = :sessionId
    `;
    if (month && year) {
      holidaysQuery += ` AND EXTRACT(MONTH FROM holiday_date) = :month AND EXTRACT(YEAR FROM holiday_date) = :year`;
    }

    query = `(${query}) UNION ALL (${holidaysQuery})`;
    query += ` ORDER BY start_date ASC`;

    const [events] = await sequelize.query(query, { replacements });
    res.ok(events);
  } catch (err) { next(err); }
};
