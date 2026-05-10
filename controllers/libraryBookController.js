'use strict';

const { LibraryBook, LibraryIssue, sequelize } = require('../models');
const { Op } = require('sequelize');

exports.getBooks = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { page = 1, limit = 20, search, category, availability } = req.query;
    const offset = (page - 1) * limit;

    const where = { school_id: schoolId, is_deleted: false };

    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { author: { [Op.iLike]: `%${search}%` } },
        { isbn: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (category) {
      where.category = category;
    }

    if (availability === 'available') {
      where.available_copies = { [Op.gt]: 0 };
    } else if (availability === 'out_of_stock') {
      where.available_copies = 0;
    }

    const { count, rows } = await LibraryBook.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['title', 'ASC']]
    });

    res.ok({
      books: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });
  } catch (err) { next(err); }
};

exports.getBook = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const book = await LibraryBook.findOne({
      where: { id, school_id: schoolId, is_deleted: false },
      include: [
        {
          model: LibraryIssue,
          as: 'issues',
          where: { status: 'issued' },
          required: false,
          limit: 5,
          order: [['issue_date', 'DESC']]
        }
      ]
    });

    if (!book) return res.fail('Book not found', [], 404);

    res.ok(book);
  } catch (err) { next(err); }
};

exports.createBook = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { title, author, publisher, isbn, category, total_copies, shelf_location, publication_year, description } = req.body;

    const book = await LibraryBook.create({
      school_id: schoolId,
      title,
      author,
      publisher,
      isbn,
      category,
      total_copies: total_copies || 0,
      available_copies: total_copies || 0,
      shelf_location,
      publication_year,
      description
    });

    res.ok(book, 'Book added to catalog.', 201);
  } catch (err) { next(err); }
};

exports.updateBook = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { title, author, publisher, isbn, category, total_copies, shelf_location, publication_year, description } = req.body;

    const book = await LibraryBook.findOne({ where: { id, school_id: schoolId, is_deleted: false }, transaction });
    if (!book) {
      await transaction.rollback();
      return res.fail('Book not found', [], 404);
    }

    const diff = (total_copies || 0) - book.total_copies;
    const newAvailable = book.available_copies + diff;

    if (newAvailable < 0) {
      await transaction.rollback();
      return res.fail('Total copies cannot be less than currently issued copies.', [], 400);
    }

    await book.update({
      title, author, publisher, isbn, category,
      total_copies: total_copies || 0,
      available_copies: newAvailable,
      shelf_location, publication_year, description
    }, { transaction });

    await transaction.commit();
    res.ok(book, 'Book updated.');
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
};

exports.deleteBook = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const book = await LibraryBook.findOne({ where: { id, school_id: schoolId, is_deleted: false } });
    if (!book) return res.fail('Book not found', [], 404);

    // Soft delete
    await book.update({ is_deleted: true });
    res.ok(null, 'Book deleted from catalog.');
  } catch (err) { next(err); }
};
