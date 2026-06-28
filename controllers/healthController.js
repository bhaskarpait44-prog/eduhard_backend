'use strict';

const sequelize = require('../config/database');

exports.getHealthProfile = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const schoolId = req.user.school_id;

    // Verify student belongs to school
    const [[student]] = await sequelize.query(`
      SELECT id FROM students WHERE id = :student_id AND school_id = :schoolId;
    `, { replacements: { student_id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    // Fetch blood group from current student profile version
    const [[sp]] = await sequelize.query(`
      SELECT blood_group FROM student_profiles WHERE student_id = :student_id AND is_current = true;
    `, { replacements: { student_id } });
    const studentBloodGroup = sp?.blood_group || null;

    let [[profile]] = await sequelize.query(`
      SELECT * FROM student_health_profiles WHERE student_id = :student_id
    `, { replacements: { student_id } });

    if (!profile) {
      const [newProfile] = await sequelize.query(`
        INSERT INTO student_health_profiles (student_id, blood_group, created_at, updated_at)
        VALUES (:student_id, :blood_group, NOW(), NOW())
        RETURNING *
      `, { replacements: { student_id, blood_group: studentBloodGroup } });
      profile = newProfile[0];
    } else if (!profile.blood_group && studentBloodGroup) {
      const [updatedProfile] = await sequelize.query(`
        UPDATE student_health_profiles SET blood_group = :blood_group, updated_at = NOW()
        WHERE id = :profileId
        RETURNING *
      `, { replacements: { blood_group: studentBloodGroup, profileId: profile.id } });
      profile = updatedProfile[0];
    }

    const [vaccinations] = await sequelize.query(`
      SELECT * FROM student_vaccinations WHERE student_id = :student_id ORDER BY date_administered DESC
    `, { replacements: { student_id } });

    const [incidents] = await sequelize.query(`
      SELECT * FROM student_health_incidents WHERE student_id = :student_id ORDER BY incident_date DESC, incident_time DESC
    `, { replacements: { student_id } });

    res.ok({ profile, vaccinations, incidents });
  } catch (err) { next(err); }
};

exports.updateHealthProfile = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const { blood_group, height_cm, weight_kg, allergies, medical_conditions } = req.body;
    
    const [[existing]] = await sequelize.query(`
      SELECT id FROM student_health_profiles WHERE student_id = :student_id
    `, { replacements: { student_id } });

    let profile;
    if (existing) {
      [profile] = await sequelize.query(`
        UPDATE student_health_profiles SET
          blood_group = :blood_group,
          height_cm = :height_cm,
          weight_kg = :weight_kg,
          allergies = :allergies,
          medical_conditions = :medical_conditions,
          updated_at = NOW()
        WHERE student_id = :student_id
        RETURNING *
      `, { replacements: { 
        student_id, blood_group, 
        height_cm: height_cm || null, 
        weight_kg: weight_kg || null, 
        allergies, medical_conditions 
      } });
    } else {
      [profile] = await sequelize.query(`
        INSERT INTO student_health_profiles (
          student_id, blood_group, height_cm, weight_kg, allergies, medical_conditions, created_at, updated_at
        ) VALUES (
          :student_id, :blood_group, :height_cm, :weight_kg, :allergies, :medical_conditions, NOW(), NOW()
        ) RETURNING *
      `, { replacements: { 
        student_id, blood_group, 
        height_cm: height_cm || null, 
        weight_kg: weight_kg || null, 
        allergies, medical_conditions 
      } });
    }

    res.ok(profile[0], 'Health profile updated.');
  } catch (err) { next(err); }
};

exports.addVaccination = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const { vaccine_name, date_administered, next_due_date, remarks } = req.body;

    const [vaccination] = await sequelize.query(`
      INSERT INTO student_vaccinations (
        student_id, vaccine_name, date_administered, next_due_date, remarks, created_at, updated_at
      ) VALUES (
        :student_id, :vaccine_name, :date_administered, :next_due_date, :remarks, NOW(), NOW()
      ) RETURNING *
    `, { replacements: { 
      student_id, vaccine_name, 
      date_administered: date_administered || null, 
      next_due_date: next_due_date || null, 
      remarks 
    } });

    res.ok(vaccination[0], 'Vaccination recorded.', 201);
  } catch (err) { next(err); }
};

exports.deleteVaccination = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await sequelize.query(`
      DELETE FROM student_vaccinations WHERE id = :id RETURNING id
    `, { replacements: { id } });

    if (result.length === 0) return res.fail('Vaccination record not found.', [], 404);

    res.ok(null, 'Vaccination deleted.');
  } catch (err) { next(err); }
};

exports.addIncident = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const { incident_date, incident_time, type, description, action_taken } = req.body;

    const [incident] = await sequelize.query(`
      INSERT INTO student_health_incidents (
        student_id, incident_date, incident_time, type, description, action_taken, reported_by, created_at, updated_at
      ) VALUES (
        :student_id, :incident_date, :incident_time, :type, :description, :action_taken, :reported_by, NOW(), NOW()
      ) RETURNING *
    `, { replacements: { 
      student_id, incident_date, 
      incident_time: incident_time || null, 
      type, description, action_taken, 
      reported_by: req.user.id 
    } });

    res.ok(incident[0], 'Incident recorded.', 201);
  } catch (err) { next(err); }
};

exports.deleteIncident = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await sequelize.query(`
      DELETE FROM student_health_incidents WHERE id = :id RETURNING id
    `, { replacements: { id } });

    if (result.length === 0) return res.fail('Incident record not found.', [], 404);

    res.ok(null, 'Incident deleted.');
  } catch (err) { next(err); }
};
