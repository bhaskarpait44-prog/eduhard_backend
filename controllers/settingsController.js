'use strict';

const sequelize = require('../config/database');
const { invalidateCache } = require('../middlewares/cache');

exports.getSettings = async (req, res, next) => {
  try {
    const [[school]] = await sequelize.query(`
      SELECT id, name, upi_id, upi_name, upi_enabled, email, phone, address, online_admission_open
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
      school_email: school.email,
      school_phone: school.phone,
      school_address: school.address,
      online_admission_open: !!school.online_admission_open,
    });
  } catch (err) { next(err); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const { 
      upi_id, upi_name, upi_enabled, 
      school_name, school_email, school_phone, school_address,
      online_admission_open
    } = req.body;
    const schoolId = req.user.school_id;

    await sequelize.query(`
      UPDATE schools
      SET 
        upi_id = :upiId, 
        upi_name = :upiName, 
        upi_enabled = :upiEnabled,
        name = COALESCE(NULLIF(:schoolName, ''), name),
        email = :schoolEmail,
        phone = :schoolPhone,
        address = :schoolAddress,
        online_admission_open = :onlineAdmissionOpen,
        updated_at = NOW()
      WHERE id = :schoolId;
    `, { replacements: { 
      upiId: upi_id || null, 
      upiName: upi_name || null, 
      upiEnabled: upi_enabled !== undefined ? upi_enabled : true,
      schoolName: school_name || null,
      schoolEmail: school_email || null,
      schoolPhone: school_phone || null,
      schoolAddress: school_address || null,
      onlineAdmissionOpen: online_admission_open !== undefined ? online_admission_open : false,
      schoolId 
    } });

    res.ok({ 
      upi_id, upi_name, upi_enabled, 
      school_name, school_email, school_phone, school_address,
      online_admission_open
    }, 'Settings updated successfully.');

    try {
      invalidateCache(schoolId, '/api/settings*');
      invalidateCache(schoolId, '/api/student*');
    } catch (cacheErr) {
      console.error('[Cache Invalidation Error] Failed to clear settings/student caches:', cacheErr.message);
    }
  } catch (err) { next(err); }
};
