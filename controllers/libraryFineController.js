'use strict';

const sequelize = require('../config/database');

exports.getFines = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { page = 1, limit = 20, fine_status = 'pending', search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE li.school_id = :schoolId AND li.fine_amount > 0';
    const replacements = { 
      schoolId, 
      fine_status, 
      search: search ? `%${search}%` : undefined,
      limit: parseInt(limit), 
      offset: parseInt(offset) 
    };

    if (fine_status) whereClause += ' AND li.fine_status = :fine_status';
    if (search) whereClause += ` AND (lb.title ILIKE :search OR (s.first_name || ' ' || s.last_name) ILIKE :search OR u.name ILIKE :search)`;

    const [fines] = await sequelize.query(`
      SELECT 
        li.*, 
        lb.title AS book_title,
        CASE 
          WHEN li.borrower_type = 'student' THEN CONCAT(s.first_name, ' ', s.last_name)
          ELSE u.name 
        END AS borrower_name,
        CASE 
          WHEN li.borrower_type = 'student' THEN s.admission_no
          ELSE u.email
        END AS borrower_identifier
      FROM library_issues li
      JOIN library_books lb ON lb.id = li.book_id
      LEFT JOIN students s ON s.id = li.borrower_id AND li.borrower_type = 'student'
      LEFT JOIN users u ON u.id = li.borrower_id AND li.borrower_type = 'staff'
      ${whereClause}
      ORDER BY li.return_date DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    const [[{ count }]] = await sequelize.query(`
       SELECT COUNT(*)::int FROM library_issues li
       JOIN library_books lb ON lb.id = li.book_id
       LEFT JOIN students s ON s.id = li.borrower_id AND li.borrower_type = 'student'
       LEFT JOIN users u ON u.id = li.borrower_id AND li.borrower_type = 'staff'
       ${whereClause}
    `, { replacements });

    res.ok({
      fines,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });
  } catch (err) { next(err); }
};

exports.updateFineStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { fine_status, fine_remarks } = req.body;

    const [result] = await sequelize.query(`
      UPDATE library_issues SET 
        fine_status = :fine_status, 
        fine_remarks = :fine_remarks, 
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId AND fine_amount > 0
      RETURNING *
    `, { replacements: { id, schoolId, fine_status, fine_remarks } });

    if (result.length === 0) return res.fail('Fine record not found', [], 404);

    res.ok(result[0], `Fine marked as ${fine_status}.`);
  } catch (err) { next(err); }
};

exports.getFineSummary = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    const [[summary]] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN fine_status = 'paid' THEN fine_amount ELSE 0 END), 0)::float AS total_collected,
        COALESCE(SUM(CASE WHEN fine_status = 'waived' THEN fine_amount ELSE 0 END), 0)::float AS total_waived,
        COALESCE(SUM(CASE WHEN fine_status = 'pending' THEN fine_amount ELSE 0 END), 0)::float AS total_pending
      FROM library_issues
      WHERE school_id = :schoolId AND fine_amount > 0
    `, { replacements: { schoolId } });

    res.ok(summary);
  } catch (err) { next(err); }
};
