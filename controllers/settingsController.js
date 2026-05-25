'use strict';

const sequelize = require('../config/database');
const { invalidateCache } = require('../middlewares/cache');

exports.getSettings = async (req, res, next) => {
  try {
    const [[school]] = await sequelize.query(`
      SELECT id, name, upi_id
      FROM schools
      WHERE id = :schoolId
      LIMIT 1;
    `, { replacements: { schoolId: req.user.school_id } });

    if (!school) return res.fail('School record not found.', [], 404);

    res.ok({
      upi_id: school.upi_id,
      school_name: school.name,
    });
  } catch (err) { next(err); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const { upi_id } = req.body;
    const schoolId = req.user.school_id;

    await sequelize.query(`
      UPDATE schools
      SET upi_id = :upiId, updated_at = NOW()
      WHERE id = :schoolId;
    `, { replacements: { upiId: upi_id || null, schoolId } });

    res.ok({ upi_id }, 'Settings updated successfully.');
    invalidateCache(schoolId, '/api/settings*');
  } catch (err) { next(err); }
};
