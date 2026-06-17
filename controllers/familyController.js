'use strict';

const sequelize = require('../config/database');

exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    const [[{ total }]] = await sequelize.query(
      `SELECT COUNT(*) AS total FROM families WHERE school_id = :schoolId`,
      { replacements: { schoolId } }
    );

    const [families] = await sequelize.query(`
      SELECT 
        f.id, f.family_name, f.primary_contact, f.phone, f.email, f.user_id,
        u.name AS parent_user_name,
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
      LEFT JOIN users u ON u.id = f.user_id
      WHERE f.school_id = :schoolId
      ORDER BY f.family_name ASC, f.primary_contact ASC
      LIMIT :limit OFFSET :offset;
    `, { replacements: { schoolId, limit, offset } });

    res.ok({ families, total: Number(total), page, limit });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const schoolId = req.user.school_id;
    const { family_name, primary_contact, phone, email, student_ids, user_id } = req.body;

    const [family] = await sequelize.query(`
      INSERT INTO families (school_id, family_name, primary_contact, phone, email, user_id, created_at, updated_at)
      VALUES (:schoolId, :family_name, :primary_contact, :phone, :email, :user_id, NOW(), NOW())
      RETURNING *
    `, { replacements: { schoolId, family_name, primary_contact, phone, email, user_id: user_id || null }, transaction: t });

    if (student_ids && student_ids.length > 0) {
      await sequelize.query(`
        UPDATE students SET family_id = :familyId WHERE id IN (:studentIds) AND school_id = :schoolId
      `, { replacements: { familyId: family[0].id, studentIds: student_ids, schoolId }, transaction: t });
    }

    await t.commit();
    res.ok(family[0], 'Family created successfully.', 201);
  } catch (err) { 
    await t.rollback();
    next(err); 
  }
};

exports.update = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { family_name, primary_contact, phone, email, student_ids, user_id } = req.body;

    const [result] = await sequelize.query(`
      UPDATE families SET
        family_name = :family_name,
        primary_contact = :primary_contact,
        phone = :phone,
        email = :email,
        user_id = :user_id,
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
      RETURNING *
    `, { replacements: { id, schoolId, family_name, primary_contact, phone, email, user_id: user_id || null }, transaction: t });

    if (result.length === 0) {
      await t.rollback();
      return res.fail('Family not found.', [], 404);
    }

    if (student_ids !== undefined) {
      // Unlink all current students
      await sequelize.query(`UPDATE students SET family_id = NULL WHERE family_id = :familyId AND school_id = :schoolId`, { replacements: { familyId: id, schoolId }, transaction: t });
      
      // Link new ones
      if (student_ids.length > 0) {
        await sequelize.query(`UPDATE students SET family_id = :familyId WHERE id IN (:studentIds) AND school_id = :schoolId`, { replacements: { familyId: id, studentIds: student_ids, schoolId }, transaction: t });
      }
    }

    await t.commit();
    res.ok(result[0], 'Family updated successfully.');
  } catch (err) { 
    await t.rollback();
    next(err); 
  }
};

exports.remove = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    // Unlink first
    await sequelize.query(`UPDATE students SET family_id = NULL WHERE family_id = :familyId AND school_id = :schoolId`, { replacements: { familyId: id, schoolId }, transaction: t });
    
    const [result] = await sequelize.query(`
      DELETE FROM families WHERE id = :id AND school_id = :schoolId RETURNING id
    `, { replacements: { id, schoolId }, transaction: t });

    if (result.length === 0) {
      await t.rollback();
      return res.fail('Family not found.', [], 404);
    }

    await t.commit();
    res.ok(null, 'Family deleted and siblings unlinked.');
  } catch (err) { 
    await t.rollback();
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

    const [[family]] = await sequelize.query(`
      SELECT f.* FROM families f WHERE f.id = :familyId AND f.school_id = :schoolId
    `, { replacements: { familyId: student.family_id, schoolId } });

    const [siblings] = await sequelize.query(`
      SELECT id, first_name, last_name, admission_no
      FROM students
      WHERE family_id = :familyId 
        AND school_id = :schoolId
        AND id <> :studentId
        AND is_deleted = false
      ORDER BY first_name ASC
    `, { replacements: { familyId: student.family_id, schoolId, studentId: student_id } });

    res.ok({ ...family, siblings });
  } catch (err) { next(err); }
};
