'use strict';

const sequelize = require('../config/database');

exports.getSettings = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const [[settings]] = await sequelize.query(`
      SELECT * FROM library_settings WHERE school_id = :schoolId
    `, { replacements: { schoolId } });

    if (!settings) {
      return res.ok({
        fine_per_day: 2,
        max_books_per_borrower: 3,
        max_issue_days: 14
      });
    }
    res.ok(settings);
  } catch (err) { next(err); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { fine_per_day, max_books_per_borrower, max_issue_days } = req.body;

    // Validate settings values
    if (!fine_per_day || parseFloat(fine_per_day) <= 0) {
      return res.fail('Fine per day must be a positive number.', [], 400);
    }
    if (!max_books_per_borrower || parseInt(max_books_per_borrower) < 1) {
      return res.fail('Max books per borrower must be at least 1.', [], 400);
    }
    if (!max_issue_days || parseInt(max_issue_days) < 1) {
      return res.fail('Max issue days must be at least 1.', [], 400);
    }

    const [[existing]] = await sequelize.query(`
      SELECT id FROM library_settings WHERE school_id = :schoolId
    `, { replacements: { schoolId } });

    let settings;
    if (existing) {
      [settings] = await sequelize.query(`
        UPDATE library_settings SET
          fine_per_day = :fine_per_day,
          max_books_per_borrower = :max_books_per_borrower,
          max_issue_days = :max_issue_days,
          updated_at = NOW()
        WHERE school_id = :schoolId
        RETURNING *
      `, { replacements: { schoolId, fine_per_day, max_books_per_borrower, max_issue_days } });
    } else {
      [settings] = await sequelize.query(`
        INSERT INTO library_settings (
          school_id, fine_per_day, max_books_per_borrower, max_issue_days, created_at, updated_at
        ) VALUES (
          :schoolId, :fine_per_day, :max_books_per_borrower, :max_issue_days, NOW(), NOW()
        ) RETURNING *
      `, { replacements: { schoolId, fine_per_day, max_books_per_borrower, max_issue_days } });
    }

    res.ok(settings[0], 'Library settings updated.');
  } catch (err) { next(err); }
};
