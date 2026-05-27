'use strict';

const sequelize = require('../config/database');

const getSettings = async (schoolId) => {
  const [[settings]] = await sequelize.query(`
    SELECT * FROM library_settings WHERE school_id = :schoolId
  `, { replacements: { schoolId } });

  if (!settings) {
    return {
      fine_per_day: 2,
      max_books_per_borrower: 3,
      max_issue_days: 14
    };
  }
  return settings;
};

exports.issueBook = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const schoolId = req.user.school_id;
    const { book_id, borrower_type, borrower_id, due_date } = req.body;

    const settings = await getSettings(schoolId);

    // 1. Check book availability
    const [[book]] = await sequelize.query(`
      SELECT * FROM library_books WHERE id = :book_id AND school_id = :schoolId AND is_deleted = false
    `, { replacements: { book_id, schoolId }, transaction: t });

    if (!book) {
      await t.rollback();
      return res.fail('Book not found.', [], 404);
    }
    if (book.available_copies <= 0) {
      await t.rollback();
      return res.fail('No copies available for this book.', [], 400);
    }

    // 2. Check borrower limits
    const [[{ activeIssuesCount }]] = await sequelize.query(`
      SELECT COUNT(*)::int AS "activeIssuesCount" FROM library_issues 
      WHERE school_id = :schoolId AND borrower_type = :borrower_type AND borrower_id = :borrower_id AND status != 'returned'
    `, { replacements: { schoolId, borrower_type, borrower_id }, transaction: t });

    if (activeIssuesCount >= settings.max_books_per_borrower) {
      await t.rollback();
      return res.fail(`Borrower has already reached the limit of ${settings.max_books_per_borrower} books.`, [], 400);
    }

    // 3. Check for overdue books
    const [[{ overdueCount }]] = await sequelize.query(`
      SELECT COUNT(*)::int AS "overdueCount" FROM library_issues 
      WHERE school_id = :schoolId AND borrower_type = :borrower_type AND borrower_id = :borrower_id AND status = 'overdue'
    `, { replacements: { schoolId, borrower_type, borrower_id }, transaction: t });

    if (overdueCount > 0) {
      await t.rollback();
      return res.fail('Borrower has overdue books. Cannot issue new books until they are returned.', [], 400);
    }

    // 4. Issue book
    const issueDate = new Date().toISOString().split('T')[0];
    const finalDueDate = due_date || new Date(Date.now() + settings.max_issue_days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [issue] = await sequelize.query(`
      INSERT INTO library_issues (
        school_id, book_id, borrower_type, borrower_id, 
        issue_date, due_date, status, issued_by, created_at, updated_at
      ) VALUES (
        :schoolId, :book_id, :borrower_type, :borrower_id, 
        :issueDate, :finalDueDate, 'issued', :issuedBy, NOW(), NOW()
      ) RETURNING *
    `, { 
      replacements: { 
        schoolId, book_id, borrower_type, borrower_id, 
        issueDate, finalDueDate, issuedBy: req.user.id 
      },
      transaction: t
    });

    await sequelize.query(`
      UPDATE library_books SET available_copies = available_copies - 1, updated_at = NOW()
      WHERE id = :book_id
    `, { replacements: { book_id }, transaction: t });

    // Handle Reservations: If this borrower had a reservation, mark it as completed
    await sequelize.query(`
      UPDATE library_reservations SET
        status = 'completed',
        updated_at = NOW()
      WHERE book_id = :book_id AND borrower_id = :borrower_id AND borrower_type = :borrower_type AND status IN ('pending', 'ready')
    `, { replacements: { book_id, borrower_id, borrower_type }, transaction: t });

    await t.commit();
    res.ok(issue[0], 'Book issued successfully.', 201);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

exports.returnBook = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { return_date, fine_status, fine_remarks } = req.body;

    const [[issue]] = await sequelize.query(`
      SELECT * FROM library_issues WHERE id = :id AND school_id = :schoolId AND status != 'returned'
    `, { replacements: { id, schoolId }, transaction: t });

    if (!issue) {
      await t.rollback();
      return res.fail('Active issue record not found.', [], 404);
    }

    const finalReturnDate = return_date || new Date().toISOString().split('T')[0];
    const dueDate = new Date(issue.due_date);
    const retDate = new Date(finalReturnDate);

    let fineAmount = 0;
    if (retDate > dueDate) {
      const settings = await getSettings(schoolId);
      const diffTime = Math.abs(retDate - dueDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      fineAmount = diffDays * settings.fine_per_day;
    }

    const [updatedIssue] = await sequelize.query(`
      UPDATE library_issues SET
        return_date = :finalReturnDate,
        status = 'returned',
        fine_amount = :fineAmount,
        fine_status = :fineStatus,
        fine_remarks = :fineRemarks,
        updated_at = NOW()
      WHERE id = :id
      RETURNING *
    `, { 
      replacements: { 
        id, finalReturnDate, fineAmount, 
        fineStatus: fineAmount > 0 ? (fine_status || 'pending') : 'none',
        fineRemarks 
      },
      transaction: t
    });

    await sequelize.query(`
      UPDATE library_books SET available_copies = available_copies + 1, updated_at = NOW()
      WHERE id = :bookId
    `, { replacements: { bookId: issue.book_id }, transaction: t });

    // Handle Reservations: Check if anyone is waiting for this book
    const [[nextReservation]] = await sequelize.query(`
      SELECT id FROM library_reservations
      WHERE book_id = :bookId AND school_id = :schoolId AND status = 'pending'
      ORDER BY reservation_date ASC
      LIMIT 1
    `, { replacements: { bookId: issue.book_id, schoolId }, transaction: t });

    if (nextReservation) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 2); // 2 days to pick up

      await sequelize.query(`
        UPDATE library_reservations SET
          status = 'ready',
          expires_at = :expiresAt,
          updated_at = NOW()
        WHERE id = :reservationId
      `, { 
        replacements: { 
          reservationId: nextReservation.id,
          expiresAt
        },
        transaction: t
      });
      // In a real app, send a push notification here
    }

    await t.commit();
    res.ok(updatedIssue[0], 'Book returned successfully.' + (nextReservation ? ' Next reservation marked as ready.' : ''));
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

exports.getIssues = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { page = 1, limit = 20, status, borrower_type, start_date, end_date, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE li.school_id = :schoolId';
    const replacements = { 
      schoolId, 
      limit: parseInt(limit), 
      offset: parseInt(offset),
      status, 
      borrower_type, 
      start_date, 
      end_date,
      search: search ? `%${search}%` : undefined
    };

    if (status) whereClause += ' AND li.status = :status';
    if (borrower_type) whereClause += ' AND li.borrower_type = :borrower_type';
    if (start_date && end_date) whereClause += ' AND li.issue_date BETWEEN :start_date AND :end_date';
    if (search) whereClause += ` AND (lb.title ILIKE :search OR (s.first_name || ' ' || s.last_name) ILIKE :search OR u.name ILIKE :search)`;

    const [issues] = await sequelize.query(`
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
        END AS borrower_identifier,
        c.name AS class_name
      FROM library_issues li
      JOIN library_books lb ON lb.id = li.book_id
      LEFT JOIN students s ON s.id = li.borrower_id AND li.borrower_type = 'student'
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN users u ON u.id = li.borrower_id AND li.borrower_type = 'staff'
      ${whereClause}
      ORDER BY li.issue_date DESC
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
      issues,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });
  } catch (err) { next(err); }
};

exports.getMyIssues = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const userId = req.user.id;
    const role = req.user.role;

    let borrowerId = userId;
    let borrowerType = 'staff';

    if (role === 'student') {
      const [[student]] = await sequelize.query(`
        SELECT s.id FROM students s
        WHERE s.user_id = :userId AND s.school_id = :schoolId
      `, { replacements: { userId, schoolId } });
      
      if (!student) return res.fail('Student record not found', [], 404);
      borrowerId = student.id;
      borrowerType = 'student';
    }

    const [issues] = await sequelize.query(`
      SELECT li.*, lb.title AS book_title, lb.author AS book_author
      FROM library_issues li
      JOIN library_books lb ON lb.id = li.book_id
      WHERE li.school_id = :schoolId AND li.borrower_id = :borrowerId AND li.borrower_type = :borrowerType
      ORDER BY li.issue_date DESC
    `, { replacements: { schoolId, borrowerId, borrowerType } });

    res.ok(issues);
  } catch (err) { next(err); }
};

exports.markOverdue = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const today = new Date().toISOString().split('T')[0];

    const [result] = await sequelize.query(`
      UPDATE library_issues SET status = 'overdue', updated_at = NOW()
      WHERE school_id = :schoolId AND status = 'issued' AND due_date < :today
      RETURNING id
    `, { replacements: { schoolId, today } });

    res.ok({ updatedCount: result.length }, `${result.length} issues marked as overdue.`);
  } catch (err) { next(err); }
};
