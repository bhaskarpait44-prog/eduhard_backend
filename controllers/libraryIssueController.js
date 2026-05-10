'use strict';

const { LibraryBook, LibraryIssue, LibrarySetting, Student, User, sequelize } = require('../models');
const { Op } = require('sequelize');

const getSettings = async (schoolId) => {
  let settings = await LibrarySetting.findOne({ where: { school_id: schoolId } });
  if (!settings) {
    settings = {
      fine_per_day: 2,
      max_books_per_borrower: 3,
      max_issue_days: 14
    };
  }
  return settings;
};

exports.issueBook = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const schoolId = req.user.school_id;
    const { book_id, borrower_type, borrower_id, due_date } = req.body;

    const settings = await getSettings(schoolId);

    // 1. Check book availability
    const book = await LibraryBook.findOne({ where: { id: book_id, school_id: schoolId, is_deleted: false }, transaction });
    if (!book) {
      await transaction.rollback();
      return res.fail('Book not found.', [], 404);
    }
    if (book.available_copies <= 0) {
      await transaction.rollback();
      return res.fail('No copies available for this book.', [], 400);
    }

    // 2. Check borrower limits
    const activeIssuesCount = await LibraryIssue.count({
      where: { school_id: schoolId, borrower_type, borrower_id, status: { [Op.ne]: 'returned' } },
      transaction
    });

    if (activeIssuesCount >= settings.max_books_per_borrower) {
      await transaction.rollback();
      return res.fail(`Borrower has already reached the limit of ${settings.max_books_per_borrower} books.`, [], 400);
    }

    // 3. Check for overdue books
    const overdueCount = await LibraryIssue.count({
      where: { school_id: schoolId, borrower_type, borrower_id, status: 'overdue' },
      transaction
    });

    if (overdueCount > 0) {
      await transaction.rollback();
      return res.fail('Borrower has overdue books. Cannot issue new books until they are returned.', [], 400);
    }

    // 4. Issue book
    const issueDate = new Date().toISOString().split('T')[0];
    const finalDueDate = due_date || new Date(Date.now() + settings.max_issue_days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const issue = await LibraryIssue.create({
      school_id: schoolId,
      book_id,
      borrower_type,
      borrower_id,
      issue_date: issueDate,
      due_date: finalDueDate,
      status: 'issued',
      issued_by: req.user.id
    }, { transaction });

    await book.update({ available_copies: book.available_copies - 1 }, { transaction });

    await transaction.commit();
    res.ok(issue, 'Book issued successfully.', 201);
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
};

exports.returnBook = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { return_date, fine_status, fine_remarks } = req.body;

    const issue = await LibraryIssue.findOne({
      where: { id, school_id: schoolId, status: { [Op.ne]: 'returned' } },
      include: [{ model: LibraryBook, as: 'book' }],
      transaction
    });

    if (!issue) {
      await transaction.rollback();
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

    await issue.update({
      return_date: finalReturnDate,
      status: 'returned',
      fine_amount: fineAmount,
      fine_status: fineAmount > 0 ? (fine_status || 'pending') : 'none',
      fine_remarks
    }, { transaction });

    await issue.book.update({ available_copies: issue.book.available_copies + 1 }, { transaction });

    await transaction.commit();
    res.ok(issue, 'Book returned successfully.');
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
};

exports.getIssues = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { page = 1, limit = 20, status, borrower_type, start_date, end_date, search } = req.query;
    const offset = (page - 1) * limit;

    const where = { school_id: schoolId };
    if (status) where.status = status;
    if (borrower_type) where.borrower_type = borrower_type;
    if (start_date && end_date) {
      where.issue_date = { [Op.between]: [start_date, end_date] };
    }

    // Search by book title or borrower name requires raw query or complex include
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
      WHERE li.school_id = :schoolId
      ${status ? 'AND li.status = :status' : ''}
      ${borrower_type ? 'AND li.borrower_type = :borrower_type' : ''}
      ${start_date && end_date ? 'AND li.issue_date BETWEEN :start_date AND :end_date' : ''}
      ${search ? `AND (lb.title ILIKE :search OR (s.first_name || ' ' || s.last_name) ILIKE :search OR u.name ILIKE :search)` : ''}
      ORDER BY li.issue_date DESC
      LIMIT :limit OFFSET :offset
    `, {
      replacements: { 
        schoolId, status, borrower_type, start_date, end_date, 
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
       ${status ? 'AND li.status = :status' : ''}
       ${borrower_type ? 'AND li.borrower_type = :borrower_type' : ''}
       ${start_date && end_date ? 'AND li.issue_date BETWEEN :start_date AND :end_date' : ''}
       ${search ? `AND (lb.title ILIKE :search OR (s.first_name || ' ' || s.last_name) ILIKE :search OR u.name ILIKE :search)` : ''}
    `, {
      replacements: { schoolId, status, borrower_type, start_date, end_date, search: search ? `%${search}%` : undefined }
    });

    const count = parseInt(totalRes[0].count);

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
      const student = await Student.findOne({ where: { school_id: schoolId }, include: [{ model: User, where: { id: userId } }] });
      if (!student) return res.fail('Student record not found', [], 404);
      borrowerId = student.id;
      borrowerType = 'student';
    }

    const issues = await LibraryIssue.findAll({
      where: { school_id: schoolId, borrower_id: borrowerId, borrower_type: borrowerType },
      include: [{ model: LibraryBook, as: 'book', attributes: ['title', 'author'] }],
      order: [['issue_date', 'DESC']]
    });

    res.ok(issues);
  } catch (err) { next(err); }
};

exports.markOverdue = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const today = new Date().toISOString().split('T')[0];

    const [updatedCount] = await LibraryIssue.update(
      { status: 'overdue' },
      { 
        where: { 
          school_id: schoolId, 
          status: 'issued', 
          due_date: { [Op.lt]: today } 
        } 
      }
    );

    res.ok({ updatedCount }, `${updatedCount} issues marked as overdue.`);
  } catch (err) { next(err); }
};
