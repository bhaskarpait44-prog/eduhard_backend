'use strict';

const sequelize = require('../config/database');
const { invalidateCache } = require('../middlewares/cache');

exports.getSettings = async (req, res, next) => {
  try {
    const [[school]] = await sequelize.query(`
      SELECT id, name, upi_id, upi_name, upi_enabled
      FROM schools
      WHERE id = :schoolId
      LIMIT 1;
    `, { replacements: { schoolId: req.user.school_id } });

    if (!school) return res.fail('School record not found.', [], 404);

    res.ok({
      upi_id: school.upi_id,
      upi_name: school.upi_name,
      upi_enabled: !!school.upi_enabled,
      school_name: school.name,
    });
  } catch (err) { next(err); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const { upi_id, upi_name, upi_enabled, school_name } = req.body;
    const schoolId = req.user.school_id;

    await sequelize.query(`
      UPDATE schools
      SET 
        upi_id = :upiId, 
        upi_name = :upiName, 
        upi_enabled = :upiEnabled,
        name = COALESCE(NULLIF(:schoolName, ''), name),
        updated_at = NOW()
      WHERE id = :schoolId;
    `, { replacements: { 
      upiId: upi_id || null, 
      upiName: upi_name || null, 
      upiEnabled: upi_enabled !== undefined ? upi_enabled : true,
      schoolName: school_name || null,
      schoolId 
    } });

    res.ok({ upi_id, upi_name, upi_enabled, school_name }, 'Settings updated successfully.');
    invalidateCache(schoolId, '/api/settings*');
    invalidateCache(schoolId, '/api/student*');
  } catch (err) { next(err); }
};
