'use strict';

const { LibrarySetting } = require('../models');

exports.getSettings = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    let settings = await LibrarySetting.findOne({ where: { school_id: schoolId } });
    
    if (!settings) {
      // Default settings
      settings = {
        school_id: schoolId,
        fine_per_day: 2,
        max_books_per_borrower: 3,
        max_issue_days: 14
      };
    }
    
    res.ok(settings);
  } catch (err) { next(err); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { fine_per_day, max_books_per_borrower, max_issue_days } = req.body;

    let settings = await LibrarySetting.findOne({ where: { school_id: schoolId } });

    if (settings) {
      await settings.update({ fine_per_day, max_books_per_borrower, max_issue_days });
    } else {
      settings = await LibrarySetting.create({
        school_id: schoolId,
        fine_per_day,
        max_books_per_borrower,
        max_issue_days
      });
    }

    res.ok(settings, 'Library settings updated.');
  } catch (err) { next(err); }
};
