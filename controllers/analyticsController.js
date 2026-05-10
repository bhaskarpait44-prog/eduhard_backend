'use strict';

const sequelize = require('../config/database');

/**
 * GET /api/analytics/exams/:id
 * Returns:
 * - Subject-wise pass/fail distribution
 * - Subject-wise average, highest, lowest marks
 * - Grade distribution across the exam
 * - Top 5 students
 */
exports.getExamAnalytics = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[exam]] = await sequelize.query(`
      SELECT e.id, e.name, e.class_id, c.name AS class_name
      FROM exams e
      JOIN classes c ON c.id = e.class_id
      WHERE e.id = :id
      LIMIT 1;
    `, { replacements: { id } });

    if (!exam) return res.fail('Exam not found.', [], 404);

    // 1. Subject-wise stats
    const subjectStats = await sequelize.query(`
      SELECT 
        s.name AS subject_name,
        COUNT(er.id) AS total_entries,
        SUM(CASE WHEN er.is_pass = true THEN 1 ELSE 0 END) AS pass_count,
        SUM(CASE WHEN er.is_pass = false AND er.is_absent = false THEN 1 ELSE 0 END) AS fail_count,
        SUM(CASE WHEN er.is_absent = true THEN 1 ELSE 0 END) AS absent_count,
        COALESCE(ROUND(AVG(CASE WHEN er.is_absent = false THEN er.marks_obtained END), 2), 0) AS average_marks,
        COALESCE(MAX(CASE WHEN er.is_absent = false THEN er.marks_obtained END), 0) AS highest_marks,
        COALESCE(MIN(CASE WHEN er.is_absent = false THEN er.marks_obtained END), 0) AS lowest_marks
      FROM exam_subjects es
      JOIN subjects s ON s.id = es.subject_id
      LEFT JOIN exam_results er ON er.exam_id = es.exam_id AND er.subject_id = es.subject_id
      WHERE es.exam_id = :id
      GROUP BY s.id, s.name, s.order_number
      ORDER BY s.order_number;
    `, { replacements: { id: Number(id) }, type: sequelize.QueryTypes.SELECT });

    // 2. Grade distribution
    const gradeDistribution = await sequelize.query(`
      SELECT 
        grade,
        COUNT(*) AS count
      FROM exam_results
      WHERE exam_id = :id AND is_absent = false
      GROUP BY grade
      ORDER BY grade;
    `, { replacements: { id: Number(id) }, type: sequelize.QueryTypes.SELECT });

    // 3. Top Performers (Overall in this exam)
    const topPerformers = await sequelize.query(`
      SELECT 
        CONCAT(stu.first_name, ' ', stu.last_name) AS student_name,
        e.roll_number,
        COALESCE(SUM(er.marks_obtained), 0) AS total_obtained,
        COALESCE(SUM(es.combined_total_marks), 0) AS total_max,
        COALESCE(ROUND((SUM(er.marks_obtained) / NULLIF(SUM(es.combined_total_marks), 0)) * 100, 2), 0) AS percentage
      FROM enrollments e
      JOIN students stu ON stu.id = e.student_id
      JOIN exam_results er ON er.enrollment_id = e.id AND er.exam_id = :id
      JOIN exam_subjects es ON es.exam_id = er.exam_id AND es.subject_id = er.subject_id
      WHERE er.exam_id = :id
      GROUP BY e.id, stu.id, e.roll_number
      ORDER BY percentage DESC
      LIMIT 5;
    `, { replacements: { id: Number(id) }, type: sequelize.QueryTypes.SELECT });

    res.ok({
      exam,
      subject_stats: subjectStats,
      grade_distribution: gradeDistribution,
      top_performers: topPerformers
    });
  } catch (err) { next(err); }
};
