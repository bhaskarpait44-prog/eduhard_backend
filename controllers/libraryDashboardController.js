'use strict';

const sequelize = require('../config/database');

exports.getDashboardStats = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [[stats]] = await sequelize.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM library_books WHERE school_id = :schoolId AND is_deleted = false) AS total_books,
        (SELECT COALESCE(SUM(available_copies), 0)::int FROM library_books WHERE school_id = :schoolId AND is_deleted = false) AS total_available_copies,
        (SELECT COUNT(*)::int FROM library_issues WHERE school_id = :schoolId AND status != 'returned') AS total_currently_issued,
        (SELECT COUNT(*)::int FROM library_issues WHERE school_id = :schoolId AND status = 'overdue') AS total_overdue,
        (SELECT COALESCE(SUM(fine_amount), 0)::float FROM library_issues WHERE school_id = :schoolId AND fine_status = 'paid' AND return_date >= :startOfMonth) AS total_fine_this_month
    `, { replacements: { schoolId, startOfMonth } });

    const [recentIssues] = await sequelize.query(`
      SELECT li.*, 
             lb.title AS book_title,
             CASE 
               WHEN li.borrower_type = 'student' THEN CONCAT(s.first_name, ' ', s.last_name)
               ELSE u.name 
             END AS borrower_name
      FROM library_issues li
      JOIN library_books lb ON lb.id = li.book_id
      LEFT JOIN students s ON s.id = li.borrower_id AND li.borrower_type = 'student'
      LEFT JOIN users u ON u.id = li.borrower_id AND li.borrower_type = 'staff'
      WHERE li.school_id = :schoolId
      ORDER BY li.issue_date DESC
      LIMIT 5
    `, { replacements: { schoolId } });

    const [topBooks] = await sequelize.query(`
      SELECT lb.title, lb.author, lb.cover_image_url, COUNT(li.id)::int AS borrow_count
      FROM library_issues li
      JOIN library_books lb ON lb.id = li.book_id
      WHERE li.school_id = :schoolId
      GROUP BY lb.id, lb.title, lb.author, lb.cover_image_url
      ORDER BY borrow_count DESC
      LIMIT 5
    `, { replacements: { schoolId } });

    const [categoryStats] = await sequelize.query(`
      SELECT category, COUNT(*)::int AS count
      FROM library_books
      WHERE school_id = :schoolId AND is_deleted = false
      GROUP BY category
      ORDER BY count DESC
    `, { replacements: { schoolId } });

    const [monthlyTrends] = await sequelize.query(`
      SELECT TO_CHAR(issue_date, 'Mon') AS month, COUNT(*)::int AS count
      FROM library_issues
      WHERE school_id = :schoolId AND issue_date >= NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR(issue_date, 'Mon'), DATE_TRUNC('month', issue_date)
      ORDER BY DATE_TRUNC('month', issue_date) ASC
    `, { replacements: { schoolId } });

    res.ok({
      stats,
      recentIssues,
      topBooks,
      categoryStats,
      monthlyTrends
    });
  } catch (err) { next(err); }
};
