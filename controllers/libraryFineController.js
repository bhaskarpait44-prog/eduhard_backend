'use strict';

const { LibraryIssue, LibraryBook, Student, User, sequelize } = require('../models');
const { Op } = require('sequelize');

exports.getFines = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { page = 1, limit = 20, fine_status = 'pending', search } = req.query;
    const offset = (page - 1) * limit;

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
      WHERE li.school_id = :schoolId
      AND li.fine_amount > 0
      ${fine_status ? 'AND li.fine_status = :fine_status' : ''}
      ${search ? `AND (lb.title ILIKE :search OR (s.first_name || ' ' || s.last_name) ILIKE :search OR u.name ILIKE :search)` : ''}
      ORDER BY li.return_date DESC
      LIMIT :limit OFFSET :offset
    `, {
      replacements: { 
        schoolId, fine_status, 
        search: search ? `%${search}%` : undefined,
        limit: parseInt(limit), offset: parseInt(offset) 
      }
    });

    const [totalRes] = await sequelize.query(`
       SELECT COUNT(*) FROM library_issues li
       JOIN library_books lb ON lb.id = li.book_id
       LEFT JOIN students s ON s.id = li.borrower_id AND li.borrower_type = 'student'
       LEFT JOIN users u ON u.id = li.borrower_id AND li.borrower_type = 'staff'
       WHERE li.school_id = :schoolId
       AND li.fine_amount > 0
       ${fine_status ? 'AND li.fine_status = :fine_status' : ''}
       ${search ? `AND (lb.title ILIKE :search OR (s.first_name || ' ' || s.last_name) ILIKE :search OR u.name ILIKE :search)` : ''}
    `, {
      replacements: { schoolId, fine_status, search: search ? `%${search}%` : undefined }
    });

    const count = parseInt(totalRes[0].count);

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

    const issue = await LibraryIssue.findOne({ where: { id, school_id: schoolId, fine_amount: { [Op.gt]: 0 } } });
    if (!issue) return res.fail('Fine record not found', [], 404);

    await issue.update({ fine_status, fine_remarks });
    res.ok(issue, `Fine marked as ${fine_status}.`);
  } catch (err) { next(err); }
};

exports.getFineSummary = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    const [summary] = await sequelize.query(`
      SELECT 
        SUM(CASE WHEN fine_status = 'paid' THEN fine_amount ELSE 0 END) AS total_collected,
        SUM(CASE WHEN fine_status = 'waived' THEN fine_amount ELSE 0 END) AS total_waived,
        SUM(CASE WHEN fine_status = 'pending' THEN fine_amount ELSE 0 END) AS total_pending
      FROM library_issues
      WHERE school_id = :schoolId AND fine_amount > 0
    `, { replacements: { schoolId } });

    res.ok(summary[0] || { total_collected: 0, total_waived: 0, total_pending: 0 });
  } catch (err) { next(err); }
};
