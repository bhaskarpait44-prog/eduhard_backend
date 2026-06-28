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
    const { title, author, publisher, isbn, category, total_copies, shelf_location, publication_year, description, digital_url, cover_image_url } = req.body;

    if (isbn) {
      const [[existing]] = await sequelize.query(`
        SELECT id FROM library_books WHERE school_id = :schoolId AND isbn = :isbn AND is_deleted = false LIMIT 1
      `, { replacements: { schoolId, isbn: String(isbn).trim() } });

      if (existing) {
        return res.fail(`A book with ISBN ${isbn} already exists in this school catalog.`, [], 409);
      }
    }

    const [book] = await sequelize.query(`
      INSERT INTO library_books (
        school_id, title, author, publisher, isbn, category, 
        total_copies, available_copies, shelf_location, 
        publication_year, description, digital_url, cover_image_url, created_at, updated_at
      ) VALUES (
        :schoolId, :title, :author, :publisher, :isbn, :category, 
        :total_copies, :total_copies, :shelf_location, 
        :publication_year, :description, :digital_url, :cover_image_url, NOW(), NOW()
      ) RETURNING *
    `, { replacements: { 
      schoolId, 
      title: title || 'Unknown Title', 
      author: author || 'Unknown Author', 
      publisher: publisher || null, 
      isbn: isbn || null, 
      category: category || 'other', 
      total_copies: parseInt(total_copies, 10) || 0, 
      shelf_location: shelf_location || null, 
      publication_year: parseInt(publication_year, 10) || null, 
      description: description || null, 
      digital_url: digital_url || null, 
      cover_image_url: cover_image_url || null
    } });

    res.ok(book[0], 'Book added to catalog.', 201);
  } catch (err) { next(err); }
};

exports.updateBook = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { title, author, publisher, isbn, category, total_copies, shelf_location, publication_year, description, digital_url, cover_image_url } = req.body;

    const [books] = await sequelize.query(`
      SELECT * FROM library_books WHERE id = :id AND school_id = :schoolId AND is_deleted = false
    `, { replacements: { id, schoolId } });

    if (books.length === 0) return res.fail('Book not found', [], 404);
    const book = books[0];

    if (isbn && String(isbn).trim() !== String(book.isbn || '')) {
      const [[existing]] = await sequelize.query(`
        SELECT id FROM library_books WHERE school_id = :schoolId AND isbn = :isbn AND is_deleted = false AND id != :id LIMIT 1
      `, { replacements: { schoolId, isbn: String(isbn).trim(), id } });

      if (existing) {
        return res.fail(`Another book with ISBN ${isbn} already exists in this school catalog.`, [], 409);
      }
    }

    const requestedTotal = parseInt(total_copies, 10) || 0;
    const diff = requestedTotal - book.total_copies;
    const newAvailable = book.available_copies + diff;

    if (newAvailable < 0) {
      return res.fail(`Total copies cannot be less than currently issued copies. (Current issued: ${book.total_copies - book.available_copies})`, [], 400);
    }

    const [updatedBook] = await sequelize.query(`
      UPDATE library_books SET
        title = :title, author = :author, publisher = :publisher, 
        isbn = :isbn, category = :category, total_copies = :total_copies, 
        available_copies = :available_copies, shelf_location = :shelf_location, 
        publication_year = :publication_year, description = :description, 
        digital_url = :digital_url, cover_image_url = :cover_image_url,
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
      RETURNING *
    `, { replacements: { 
      id, schoolId, 
      title: title || book.title, 
      author: author || book.author, 
      publisher: publisher || null, 
      isbn: isbn || null, 
      category: category || book.category, 
      total_copies: requestedTotal, 
      available_copies: newAvailable,
      shelf_location: shelf_location || null, 
      publication_year: parseInt(publication_year, 10) || null, 
      description: description || null, 
      digital_url: digital_url || null, 
      cover_image_url: cover_image_url || null
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

exports.previewImportBooks = async (req, res, next) => {
  try {
    const { rows } = req.body;
    const schoolId = req.user.school_id;
    const results = [];
    const summary = { total: rows.length, valid: 0, invalid: 0 };

    // Get existing ISBNs to check for duplicates in the file vs database
    const [existingBooks] = await sequelize.query(`
      SELECT isbn FROM library_books WHERE school_id = :schoolId AND is_deleted = false AND isbn IS NOT NULL
    `, { replacements: { schoolId } });
    const existingIsbns = new Set(existingBooks.map(b => b.isbn));
    const isbnsInFile = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const errors = [];
      const data = {
        title: row.title?.trim(),
        author: row.author?.trim(),
        publisher: row.publisher?.trim(),
        isbn: row.isbn?.trim() || null,
        category: row.category?.trim(),
        total_copies: parseInt(row.total_copies) || 1,
        shelf_location: row.shelf_location?.trim(),
        publication_year: row.publication_year?.trim(),
        description: row.description?.trim(),
        digital_url: row.digital_url?.trim() || null,
        cover_image_url: row.cover_image_url?.trim() || null
      };

      if (!data.title) errors.push('Title is required');
      if (!data.author) errors.push('Author is required');
      
      if (data.isbn) {
        if (existingIsbns.has(data.isbn)) {
          errors.push(`ISBN ${data.isbn} already exists in database`);
        }
        if (isbnsInFile.has(data.isbn)) {
          errors.push(`Duplicate ISBN ${data.isbn} in file`);
        }
        isbnsInFile.add(data.isbn);
      }

      const is_valid = errors.length === 0;
      if (is_valid) summary.valid++;
      else summary.invalid++;

      results.push({
        row_number: i + 1,
        data,
        is_valid,
        errors
      });
    }

    res.ok({ results, summary });
  } catch (err) { next(err); }
};

exports.confirmImportBooks = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { rows } = req.body;
    const schoolId = req.user.school_id;
    let successCount = 0;

    // Re-validate: ensure required fields and no ISBN duplicates (server-side guard)
    const missingFields = rows.filter(r => !r.title || !r.author);
    if (missingFields.length > 0) {
      await t.rollback();
      return res.fail(`${missingFields.length} row(s) are missing required fields (title, author).`, [], 400);
    }

    const isbnsToInsert = rows.map(r => r.isbn).filter(Boolean);
    if (isbnsToInsert.length > 0) {
      const [existingBooks] = await sequelize.query(
        `SELECT isbn FROM library_books WHERE school_id = :schoolId AND is_deleted = false AND isbn = ANY(:isbns)`,
        { replacements: { schoolId, isbns: isbnsToInsert }, transaction: t }
      );
      if (existingBooks.length > 0) {
        await t.rollback();
        const dupes = existingBooks.map(b => b.isbn).join(', ');
        return res.fail(`Import rejected: duplicate ISBN(s) found in catalog: ${dupes}`, [], 400);
      }
    }

    for (const row of rows) {
      await sequelize.query(`
        INSERT INTO library_books (
          school_id, title, author, publisher, isbn, category, 
          total_copies, available_copies, shelf_location, 
          publication_year, description, digital_url, cover_image_url, created_at, updated_at
        ) VALUES (
          :schoolId, :title, :author, :publisher, :isbn, :category, 
          :total_copies, :total_copies, :shelf_location, 
          :publication_year, :description, :digital_url, :cover_image_url, NOW(), NOW()
        )
      `, { 
        replacements: { 
          schoolId, ...row
        },
        transaction: t
      });
      successCount++;
    }

    await t.commit();
    res.ok({ successCount }, `${successCount} books imported successfully.`);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

const https = require('https');

const httpGetJson = (url) => {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'EduCore-Library-Portal/1.0 (contact: admin@eduhard.com)'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            resolve(null); // Resolve with null on non-200 status to allow fallbacks
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
};

exports.lookupISBN = async (req, res, next) => {
  try {
    const { isbn } = req.params;
    const cleanIsbn = isbn.replace(/[- ]/g, '').trim();
    if (!cleanIsbn) {
      return res.fail('Invalid ISBN.', [], 400);
    }

    // 1. Try Open Library
    const openLibraryUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanIsbn}&format=json&jscmd=data`;
    const data = await httpGetJson(openLibraryUrl).catch(err => {
      console.error('[Lookup] OpenLibrary error:', err.message);
      return null;
    });

    const bookKey = `ISBN:${cleanIsbn}`;
    if (data && data[bookKey]) {
      const info = data[bookKey];
      return res.ok({
        source: 'open_library',
        title: info.title || '',
        author: info.authors?.map(a => a.name).join(', ') || '',
        publisher: info.publishers?.map(p => p.name).join(', ') || '',
        publication_year: info.publish_date ? parseInt(info.publish_date.match(/\d{4}/)?.[0], 10) || null : null,
        cover_image_url: info.cover?.large || info.cover?.medium || info.cover?.small || '',
        description: info.notes || ''
      });
    }

    // 2. Fallback to Google Books
    const googleBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`;
    const gData = await httpGetJson(googleBooksUrl).catch(err => {
      console.error('[Lookup] GoogleBooks error:', err.message);
      return null;
    });

    if (gData && gData.items && gData.items.length > 0) {
      const info = gData.items[0].volumeInfo;
      return res.ok({
        source: 'google_books',
        title: info.title || '',
        author: info.authors?.join(', ') || '',
        publisher: info.publisher || '',
        publication_year: info.publishedDate ? parseInt(info.publishedDate.match(/\d{4}/)?.[0], 10) || null : null,
        cover_image_url: info.imageLinks?.thumbnail || '',
        description: info.description || ''
      });
    }

    return res.fail('No book found for this ISBN. You can still enter details manually.', [], 404);
  } catch (err) {
    next(err);
  }
};
