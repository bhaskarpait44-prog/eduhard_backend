'use strict';

const sequelize = require('../config/database');

/**
 * Visitor Controller
 * Manages visitor logging, checkouts, and stats.
 */

// Ensure visitors table exists
(async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL,
        visitor_name VARCHAR(100) NOT NULL,
        visitor_phone VARCHAR(20),
        purpose VARCHAR(200),
        whom_to_meet VARCHAR(100),
        check_in_time TIMESTAMP DEFAULT NOW(),
        check_out_time TIMESTAMP,
        logged_by_user_id INTEGER,
        is_deleted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.error('[VisitorController] Error creating visitors table:', err);
  }
})();

exports.logVisitor = async (req, res, next) => {
  try {
    const { visitor_name, visitor_phone, purpose, whom_to_meet } = req.body;
    const schoolId = req.user.school_id;
    const userId = req.user.id;

    if (!visitor_name) return res.fail('Visitor name is required.');
    if (visitor_phone && !/^[0-9\+\-\s\(\)]{7,20}$/.test(visitor_phone)) {
      return res.fail('Invalid phone number format.');
    }

    const [result] = await sequelize.query(`
      INSERT INTO visitors (
        school_id, visitor_name, visitor_phone, purpose, whom_to_meet, 
        check_in_time, logged_by_user_id, created_at, updated_at
      ) VALUES (
        :schoolId, :visitor_name, :visitor_phone, :purpose, :whom_to_meet, 
        NOW(), :userId, NOW(), NOW()
      ) RETURNING *
    `, {
      replacements: { schoolId, visitor_name, visitor_phone, purpose, whom_to_meet, userId }
    });

    res.ok(result[0], 'Visitor logged successfully.', 201);
  } catch (err) { next(err); }
};

exports.checkoutVisitor = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(`
      UPDATE visitors 
      SET check_out_time = NOW(), updated_at = NOW() 
      WHERE id = :id AND school_id = :schoolId AND check_out_time IS NULL AND is_deleted = false
      RETURNING *
    `, { replacements: { id, schoolId } });

    if (result.length === 0) {
      return res.fail('Visitor not found, already checked out, or deleted.', [], 404);
    }

    res.ok(result[0], 'Visitor checked out successfully.');
  } catch (err) { next(err); }
};

exports.listVisitors = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { 
      page = 1, 
      limit = 50, 
      start_date, 
      end_date, 
      search,
      status // 'inside' or 'all'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE v.school_id = :schoolId AND v.is_deleted = false';
    const replacements = { schoolId, limit: parseInt(limit), offset };

    if (start_date && end_date) {
      where += ' AND DATE(v.check_in_time) BETWEEN :start_date AND :end_date';
      replacements.start_date = start_date;
      replacements.end_date = end_date;
    } else if (start_date) {
      where += ' AND DATE(v.check_in_time) >= :start_date';
      replacements.start_date = start_date;
    } else {
      // Default to today
      where += ' AND DATE(v.check_in_time) = CURRENT_DATE';
    }

    if (search) {
      where += ' AND (v.visitor_name ILIKE :search OR v.visitor_phone ILIKE :search OR v.purpose ILIKE :search)';
      replacements.search = `%${search}%`;
    }

    if (status === 'inside') {
      where += ' AND v.check_out_time IS NULL';
    }

    const [visitors] = await sequelize.query(`
      SELECT v.*, u.name as logged_by_name
      FROM visitors v
      LEFT JOIN users u ON u.id = v.logged_by_user_id
      ${where}
      ORDER BY v.check_in_time DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    const [[{ total }]] = await sequelize.query(`
      SELECT COUNT(*)::int as total FROM visitors v ${where}
    `, { replacements });

    res.ok({ 
      visitors,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) { next(err); }
};

exports.getTodayStats = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const today = new Date().toISOString().split('T')[0];

    const [[stats]] = await sequelize.query(`
      SELECT 
        COUNT(*)::int as total_today,
        COUNT(check_out_time)::int as checked_out,
        COUNT(*) FILTER (WHERE check_out_time IS NULL)::int as still_inside
      FROM visitors
      WHERE school_id = :schoolId AND DATE(check_in_time) = :today AND is_deleted = false
    `, { replacements: { schoolId, today } });

    res.ok(stats || { total_today: 0, checked_out: 0, still_inside: 0 });
  } catch (err) { next(err); }
};

exports.deleteVisitor = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(`
      UPDATE visitors SET is_deleted = true, updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
      RETURNING id
    `, { replacements: { id, schoolId } });

    if (result.length === 0) return res.fail('Visitor not found.', [], 404);
    res.ok(null, 'Visitor log entry deleted.');
  } catch (err) { next(err); }
};
