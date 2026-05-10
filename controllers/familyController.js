'use strict';

const sequelize = require('../config/database');
const { Family, Student } = require('../models');

exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    const [families] = await sequelize.query(`
      SELECT 
        f.id, f.family_name, f.primary_contact, f.phone, f.email,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', s.id,
              'first_name', s.first_name,
              'last_name', s.last_name,
              'admission_no', s.admission_no
            ) ORDER BY s.first_name ASC
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS siblings
      FROM families f
      LEFT JOIN students s ON s.family_id = f.id AND s.is_deleted = false
      WHERE f.school_id = :schoolId
      GROUP BY f.id
      ORDER BY f.family_name ASC, f.primary_contact ASC;
    `, { replacements: { schoolId } });

    res.ok(families);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const schoolId = req.user.school_id;
    const { family_name, primary_contact, phone, email, student_ids } = req.body;

    const family = await Family.create({
      school_id: schoolId, family_name, primary_contact, phone, email
    }, { transaction });

    if (student_ids && student_ids.length > 0) {
      await sequelize.query(`
        UPDATE students SET family_id = :familyId WHERE id IN (:studentIds) AND school_id = :schoolId
      `, { replacements: { familyId: family.id, studentIds: student_ids, schoolId }, transaction });
    }

    await transaction.commit();
    res.ok(family, 'Family created successfully.', 201);
  } catch (err) { 
    await transaction.rollback();
    next(err); 
  }
};

exports.update = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { family_name, primary_contact, phone, email, student_ids } = req.body;

    const family = await Family.findOne({ where: { id, school_id: schoolId } });
    if (!family) {
      await transaction.rollback();
      return res.fail('Family not found.', [], 404);
    }

    await family.update({ family_name, primary_contact, phone, email }, { transaction });

    if (student_ids !== undefined) {
      // Unlink all current students
      await sequelize.query(`UPDATE students SET family_id = NULL WHERE family_id = :familyId AND school_id = :schoolId`, { replacements: { familyId: id, schoolId }, transaction });
      
      // Link new ones
      if (student_ids.length > 0) {
        await sequelize.query(`UPDATE students SET family_id = :familyId WHERE id IN (:studentIds) AND school_id = :schoolId`, { replacements: { familyId: id, studentIds: student_ids, schoolId }, transaction });
      }
    }

    await transaction.commit();
    res.ok(family, 'Family updated successfully.');
  } catch (err) { 
    await transaction.rollback();
    next(err); 
  }
};

exports.remove = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    // Unlink first just to be safe, though onDelete is SET NULL
    await sequelize.query(`UPDATE students SET family_id = NULL WHERE family_id = :familyId AND school_id = :schoolId`, { replacements: { familyId: id, schoolId }, transaction });
    await Family.destroy({ where: { id, school_id: schoolId }, transaction });

    await transaction.commit();
    res.ok(null, 'Family deleted and siblings unlinked.');
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
};

exports.getStudentFamily = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`SELECT family_id FROM students WHERE id = :student_id AND school_id = :schoolId LIMIT 1`, { replacements: { student_id, schoolId } });
    
    if (!student || !student.family_id) {
      return res.ok({ family: null, siblings: [] });
    }

    const [families] = await sequelize.query(`
      SELECT 
        f.id, f.family_name, f.primary_contact, f.phone, f.email,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', s.id,
              'first_name', s.first_name,
              'last_name', s.last_name,
              'admission_no', s.admission_no
            ) ORDER BY s.first_name ASC
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS siblings
      FROM families f
      LEFT JOIN students s ON s.family_id = f.id AND s.is_deleted = false
      WHERE f.id = :familyId AND f.school_id = :schoolId
      GROUP BY f.id
      LIMIT 1;
    `, { replacements: { familyId: student.family_id, schoolId } });

    res.ok(families[0] || { family: null, siblings: [] });
  } catch (err) { next(err); }
};
