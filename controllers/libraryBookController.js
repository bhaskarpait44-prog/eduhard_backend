'use strict';

const sequelize = require('../config/database');

exports.getBooks = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { page = 1, limit = 20, search, category, availability } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE school_id = :schoolId AND is_deleted = false';
    const replacements = { schoolId, limit: parseInt(limit), offset: parseInt(offset) };

    if (search) {
      whereClause += ` AND (title ILIKE :search OR author ILIKE :search OR isbn ILIKE :search)`;
      replacements.search = `%${search}%`;
    }

    if (category) {
      whereClause += ` AND category = :category`;
      replacements.category = category;
    }

    if (availability === 'available') {
      whereClause += ` AND available_copies > 0`;
    } else if (availability === 'out_of_stock') {
      whereClause += ` AND available_copies = 0`;
    }

    const [books] = await sequelize.query(`
      SELECT * FROM library_books
      ${whereClause}
      ORDER BY title ASC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    const [[{ count }]] = await sequelize.query(`
      SELECT COUNT(*)::int AS count FROM library_books
      ${whereClause}
    `, { replacements });

    res.ok({
      books,
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

    const [books] = await sequelize.query(`
      SELECT * FROM library_books
      WHERE id = :id AND school_id = :schoolId AND is_deleted = false
    `, { replacements: { id, schoolId } });

    if (books.length === 0) return res.fail('Book not found', [], 404);
    const book = books[0];

    const [recentIssues] = await sequelize.query(`
      SELECT li.*, 
             CASE 
               WHEN li.borrower_type = 'student' THEN CONCAT(s.first_name, ' ', s.last_name)
               ELSE u.name 
             END AS borrower_name
      FROM library_issues li
      LEFT JOIN students s ON s.id = li.borrower_id AND li.borrower_type = 'student'
      LEFT JOIN users u ON u.id = li.borrower_id AND li.borrower_type = 'staff'
      WHERE li.book_id = :id AND li.status = 'issued'
      ORDER BY li.issue_date DESC
      LIMIT 5
    `, { replacements: { id } });

    book.issues = recentIssues;

    res.ok(book);
  } catch (err) { next(err); }
};

exports.createBook = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { title, author, publisher, isbn, category, total_copies, shelf_location, publication_year, description } = req.body;

    const [book] = await sequelize.query(`
      INSERT INTO library_books (
        school_id, title, author, publisher, isbn, category, 
        total_copies, available_copies, shelf_location, 
        publication_year, description, created_at, updated_at
      ) VALUES (
        :schoolId, :title, :author, :publisher, :isbn, :category, 
        :total_copies, :total_copies, :shelf_location, 
        :publication_year, :description, NOW(), NOW()
      ) RETURNING *
    `, { replacements: { 
      schoolId, title, author, publisher, isbn, category, 
      total_copies: total_copies || 0, 
      shelf_location, publication_year, description 
    } });

    res.ok(book[0], 'Book added to catalog.', 201);
  } catch (err) { next(err); }
};

exports.updateBook = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { title, author, publisher, isbn, category, total_copies, shelf_location, publication_year, description } = req.body;

    const [books] = await sequelize.query(`
      SELECT * FROM library_books WHERE id = :id AND school_id = :schoolId AND is_deleted = false
    `, { replacements: { id, schoolId } });

    if (books.length === 0) return res.fail('Book not found', [], 404);
    const book = books[0];

    const diff = (total_copies || 0) - book.total_copies;
    const newAvailable = book.available_copies + diff;

    if (newAvailable < 0) {
      return res.fail('Total copies cannot be less than currently issued copies.', [], 400);
    }

    const [updatedBook] = await sequelize.query(`
      UPDATE library_books SET
        title = :title, author = :author, publisher = :publisher, 
        isbn = :isbn, category = :category, total_copies = :total_copies, 
        available_copies = :available_copies, shelf_location = :shelf_location, 
        publication_year = :publication_year, description = :description, 
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
      RETURNING *
    `, { replacements: { 
      id, schoolId, title, author, publisher, isbn, category, 
      total_copies: total_copies || 0, 
      available_copies: newAvailable,
      shelf_location, publication_year, description 
    } });

    res.ok(updatedBook[0], 'Book updated.');
  } catch (err) { next(err); }
};

exports.deleteBook = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(`
      UPDATE library_books SET is_deleted = true, updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId AND is_deleted = false
      RETURNING id
    `, { replacements: { id, schoolId } });

    if (result.length === 0) return res.fail('Book not found', [], 404);

    res.ok(null, 'Book deleted from catalog.');
  } catch (err) { next(err); }
};
