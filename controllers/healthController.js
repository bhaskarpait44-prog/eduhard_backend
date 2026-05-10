'use strict';

const sequelize = require('../config/database');
const { StudentHealthProfile, StudentVaccination, StudentHealthIncident } = require('../models');

exports.getHealthProfile = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const schoolId = req.user.school_id;

    // Verify student belongs to school
    const [[student]] = await sequelize.query(`
      SELECT id FROM students WHERE id = :student_id AND school_id = :schoolId;
    `, { replacements: { student_id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    let profile = await StudentHealthProfile.findOne({ where: { student_id } });
    if (!profile) {
      profile = await StudentHealthProfile.create({ student_id });
    }

    const vaccinations = await StudentVaccination.findAll({ where: { student_id }, order: [['date_administered', 'DESC']] });
    const incidents = await StudentHealthIncident.findAll({ where: { student_id }, order: [['incident_date', 'DESC'], ['incident_time', 'DESC']] });

    res.ok({ profile, vaccinations, incidents });
  } catch (err) { next(err); }
};

exports.updateHealthProfile = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const { blood_group, height_cm, weight_kg, allergies, medical_conditions } = req.body;
    
    let profile = await StudentHealthProfile.findOne({ where: { student_id } });
    if (!profile) {
      profile = await StudentHealthProfile.create({ student_id, blood_group, height_cm, weight_kg, allergies, medical_conditions });
    } else {
      profile = await profile.update({ blood_group, height_cm, weight_kg, allergies, medical_conditions });
    }

    res.ok(profile, 'Health profile updated.');
  } catch (err) { next(err); }
};

exports.addVaccination = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const { vaccine_name, date_administered, next_due_date, remarks } = req.body;

    const vaccination = await StudentVaccination.create({
      student_id, vaccine_name, date_administered: date_administered || null, next_due_date: next_due_date || null, remarks
    });

    res.ok(vaccination, 'Vaccination recorded.', 201);
  } catch (err) { next(err); }
};

exports.deleteVaccination = async (req, res, next) => {
  try {
    const { id } = req.params;
    await StudentVaccination.destroy({ where: { id } });
    res.ok(null, 'Vaccination deleted.');
  } catch (err) { next(err); }
};

exports.addIncident = async (req, res, next) => {
  try {
    const { student_id } = req.params;
    const { incident_date, incident_time, type, description, action_taken } = req.body;

    const incident = await StudentHealthIncident.create({
      student_id, incident_date, incident_time: incident_time || null, type, description, action_taken, reported_by: req.user.id
    });

    res.ok(incident, 'Incident recorded.', 201);
  } catch (err) { next(err); }
};

exports.deleteIncident = async (req, res, next) => {
  try {
    const { id } = req.params;
    await StudentHealthIncident.destroy({ where: { id } });
    res.ok(null, 'Incident deleted.');
  } catch (err) { next(err); }
};
