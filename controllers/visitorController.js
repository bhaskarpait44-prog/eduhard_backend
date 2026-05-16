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

    if (!visitor_name) {
      return res.fail('Visitor name is required.');
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
      WHERE id = :id AND school_id = :schoolId AND check_out_time IS NULL
      RETURNING *
    `, { replacements: { id, schoolId } });

    if (result.length === 0) {
      return res.fail('Visitor not found or already checked out.', [], 404);
    }

    res.ok(result[0], 'Visitor checked out successfully.');
  } catch (err) { next(err); }
};

exports.listVisitors = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { date = new Date().toISOString().split('T')[0], search } = req.query;

    let where = 'WHERE v.school_id = :schoolId AND DATE(v.check_in_time) = :date';
    const replacements = { schoolId, date };

    if (search) {
      where += ' AND (v.visitor_name ILIKE :search OR v.visitor_phone ILIKE :search)';
      replacements.search = `%${search}%`;
    }

    const [visitors] = await sequelize.query(`
      SELECT v.*, u.name as logged_by_name
      FROM visitors v
      LEFT JOIN users u ON u.id = v.logged_by_user_id
      ${where}
      ORDER BY v.check_in_time DESC
    `, { replacements });

    res.ok({ visitors });
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
      WHERE school_id = :schoolId AND DATE(check_in_time) = :today
    `, { replacements: { schoolId, today } });

    res.ok(stats || { total_today: 0, checked_out: 0, still_inside: 0 });
  } catch (err) { next(err); }
};
