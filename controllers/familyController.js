'use strict';

const sequelize = require('../config/database');

exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    const [families] = await sequelize.query(`
      SELECT 
        f.id, f.family_name, f.primary_contact, f.phone, f.email,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', s.id,
                'first_name', s.first_name,
                'last_name', s.last_name,
                'admission_no', s.admission_no
              ) ORDER BY s.first_name ASC
            )
            FROM students s
            WHERE s.family_id = f.id AND s.is_deleted = false
          ),
          '[]'::json
        ) AS siblings
      FROM families f
      WHERE f.school_id = :schoolId
      ORDER BY f.family_name ASC, f.primary_contact ASC;
    `, { replacements: { schoolId } });

    res.ok(families);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { family_name, primary_contact, phone, email, student_ids } = req.body;

    const [family] = await sequelize.query(`
      INSERT INTO families (school_id, family_name, primary_contact, phone, email, created_at, updated_at)
      VALUES (:schoolId, :family_name, :primary_contact, :phone, :email, NOW(), NOW())
      RETURNING *
    `, { replacements: { schoolId, family_name, primary_contact, phone, email } });

    if (student_ids && student_ids.length > 0) {
      await sequelize.query(`
        UPDATE students SET family_id = :familyId WHERE id IN (:studentIds) AND school_id = :schoolId
      `, { replacements: { familyId: family[0].id, studentIds: student_ids, schoolId } });
    }

    res.ok(family[0], 'Family created successfully.', 201);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { family_name, primary_contact, phone, email, student_ids } = req.body;

    const [result] = await sequelize.query(`
      UPDATE families SET
        family_name = :family_name,
        primary_contact = :primary_contact,
        phone = :phone,
        email = :email,
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
      RETURNING *
    `, { replacements: { id, schoolId, family_name, primary_contact, phone, email } });

    if (result.length === 0) return res.fail('Family not found.', [], 404);

    if (student_ids !== undefined) {
      // Unlink all current students
      await sequelize.query(`UPDATE students SET family_id = NULL WHERE family_id = :familyId AND school_id = :schoolId`, { replacements: { familyId: id, schoolId } });
      
      // Link new ones
      if (student_ids.length > 0) {
        await sequelize.query(`UPDATE students SET family_id = :familyId WHERE id IN (:studentIds) AND school_id = :schoolId`, { replacements: { familyId: id, studentIds: student_ids, schoolId } });
      }
    }

    res.ok(result[0], 'Family updated successfully.');
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    // Unlink first
    await sequelize.query(`UPDATE students SET family_id = NULL WHERE family_id = :familyId AND school_id = :schoolId`, { replacements: { familyId: id, schoolId } });
    
    const [result] = await sequelize.query(`
      DELETE FROM families WHERE id = :id AND school_id = :schoolId RETURNING id
    `, { replacements: { id, schoolId } });

    if (result.length === 0) return res.fail('Family not found.', [], 404);

    res.ok(null, 'Family deleted and siblings unlinked.');
  } catch (err) { next(err); }
};

exports.getStudentFamily = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`SELECT family_id FROM students WHERE id = :student_id AND school_id = :schoolId LIMIT 1`, { replacements: { student_id, schoolId } });
    
    if (!student || !student.family_id) {
      return res.ok({ family: null, siblings: [] });
    }

    const [[family]] = await sequelize.query(`
      SELECT f.* FROM families f WHERE f.id = :familyId AND f.school_id = :schoolId
    `, { replacements: { familyId: student.family_id, schoolId } });

    const [siblings] = await sequelize.query(`
      SELECT id, first_name, last_name, admission_no
      FROM students
      WHERE family_id = :familyId AND is_deleted = false
      ORDER BY first_name ASC
    `, { replacements: { familyId: student.family_id } });

    res.ok({ ...family, siblings });
  } catch (err) { next(err); }
};
