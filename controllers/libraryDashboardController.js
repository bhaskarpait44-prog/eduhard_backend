'use strict';

const { LibraryBook, LibraryIssue, Student, User, sequelize } = require('../models');
const { Op } = require('sequelize');

exports.getDashboardStats = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Using ORM for safety and stability
    const totalBooks = await LibraryBook.count({ where: { school_id: schoolId, is_deleted: false } });
    const totalAvailableCopies = await LibraryBook.sum('available_copies', { where: { school_id: schoolId, is_deleted: false } }) || 0;
    const totalCurrentlyIssued = await LibraryIssue.count({ where: { school_id: schoolId, status: { [Op.ne]: 'returned' } } });
    const totalOverdue = await LibraryIssue.count({ where: { school_id: schoolId, status: 'overdue' } });
    const totalFineThisMonth = await LibraryIssue.sum('fine_amount', { 
      where: { 
        school_id: schoolId, 
        fine_status: 'paid', 
        updated_at: { [Op.gte]: startOfMonth } 
      } 
    }) || 0;

    const recentIssues = await LibraryIssue.findAll({
      where: { school_id: schoolId },
      include: [
        { model: LibraryBook, as: 'book', attributes: ['title'] },
        // These associations might need to be verified in models/index.js
      ],
      order: [['issue_date', 'DESC']],
      limit: 5,
    });

    // Formatting for frontend expectations
    const formattedIssues = await Promise.all(recentIssues.map(async (issue) => {
      const plain = issue.toJSON();
      let borrower_name = 'Unknown';
      
      if (issue.borrower_type === 'student') {
        const student = await Student.findByPk(issue.borrower_id);
        if (student) borrower_name = `${student.first_name} ${student.last_name}`;
      } else {
        const user = await User.findByPk(issue.borrower_id);
        if (user) borrower_name = user.name;
      }

      return {
        ...plain,
        book_title: plain.book?.title || 'Unknown Book',
        borrower_name
      };
    }));

    // Top books - simpler aggregate for stability
    const topBooksRaw = await LibraryIssue.findAll({
      attributes: [
        'book_id',
        [sequelize.fn('COUNT', sequelize.col('LibraryIssue.id')), 'borrow_count']
      ],
      where: { school_id: schoolId },
      group: ['book_id', 'book.id'],
      order: [[sequelize.literal('borrow_count'), 'DESC']],
      limit: 5,
      include: [{ model: LibraryBook, as: 'book', attributes: ['title', 'author'] }]
    });

    const topBooks = topBooksRaw.map(b => ({
      title: b.book?.title || 'Unknown',
      author: b.book?.author || 'Unknown',
      borrow_count: parseInt(b.getDataValue('borrow_count'))
    }));

    res.ok({
      stats: {
        total_books: totalBooks,
        total_available_copies: parseInt(totalAvailableCopies),
        total_currently_issued: totalCurrentlyIssued,
        total_overdue: totalOverdue,
        total_fine_this_month: parseFloat(totalFineThisMonth)
      },
      recentIssues: formattedIssues,
      topBooks
    });
  } catch (err) { next(err); }
};
