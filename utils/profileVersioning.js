'use strict';

/**
 * utils/profileVersioning.js
 *
 * The ONLY correct way to update a student profile.
 * Enforces the 7-step SCD-2 versioning process + audit log write.
 *
 * Usage in controllers (Step 5+):
 *
 *   const result = await profileVersioning.update({
 *     studentId    : 42,
 *     newData      : { address: '99 New Street', city: 'Jorhat' },
 *     changedBy    : req.user.id,
 *     changeReason : 'Family relocated — updated by admin on parent request',
 *     ipAddress    : req.ip,
 *     deviceInfo   : req.headers['user-agent'],
 *   });
 */

const { Op }        = require('sequelize');
const sequelize     = require('../config/database');
const StudentProfile = require('../models/StudentProfile');
const auditLogger   = require('./auditLogger');

const profileVersioning = {

  /**
   * Create the very first profile version for a student.
   * Called once after admission is created.
   */
  async create({ studentId, data, changedBy, changeReason, transaction = null }) {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Sanitize data: convert empty strings to null for optional/enum fields
    const sanitizedData = {};
    Object.keys(data || {}).forEach(key => {
      sanitizedData[key] = data[key] === '' ? null : data[key];
    });

    const work = async (t) => {
      return await StudentProfile.create({
        student_id    : studentId,
        ...sanitizedData,
        valid_from    : today,
        valid_to      : null,
        is_current    : true,
        changed_by    : changedBy   || null,
        change_reason : changeReason || 'Initial profile created',
      }, { transaction: t });
    };

    return transaction ? work(transaction) : sequelize.transaction(work);
  },

  /**
   * Update a student profile using the 7-step SCD-2 process.
   * Wrapped in a transaction — either all 7 steps succeed or none do.
   *
   * @returns {{ oldVersion: StudentProfile, newVersion: StudentProfile }}
   */
  async update({ studentId, newData, changedBy, changeReason, ipAddress, deviceInfo, transaction = null }) {

    // Validate reason before touching the DB
    if (!changeReason || changeReason.trim().length < 10) {
      throw new Error('change_reason must be at least 10 characters.');
    }

    const today = new Date().toISOString().split('T')[0];

    // Sanitize newData: convert empty strings to null
    const sanitizedNewData = {};
    Object.keys(newData || {}).forEach(key => {
      sanitizedNewData[key] = newData[key] === '' ? null : newData[key];
    });

    const work = async (t) => {

      // ── Fetch current version ────────────────────────────────────────
      const oldVersion = await StudentProfile.scope('allVersions').findOne({
        where       : { student_id: studentId, is_current: true },
        transaction : t,
        lock        : t.LOCK.UPDATE,  // Lock row to prevent race conditions
      });

      if (!oldVersion) {
        throw new Error(
          `No current profile found for student_id=${studentId}. ` +
          `Use profileVersioning.create() first.`
        );
      }

      // ── Step 1 & 2: Close the old version ───────────────────────────
      // Only valid_to and is_current change — data columns stay intact.
      // Raw query bypasses the model hook (which only guards data columns).
      await sequelize.query(`
        UPDATE student_profiles
        SET valid_to   = :today,
            is_current = false
        WHERE id = :id
      `, {
        replacements : { today, id: oldVersion.id },
        transaction  : t,
      });

      // ── Steps 3–6: Create new version ───────────────────────────────
      // Spread old values first, then overlay with new data.
      // This means partial updates work — only pass what changed.
      const newVersion = await StudentProfile.create({
        student_id        : studentId,
        // Carry forward all existing values
        address           : oldVersion.address,
        city              : oldVersion.city,
        state             : oldVersion.state,
        pincode           : oldVersion.pincode,
        phone             : oldVersion.phone,
        email             : oldVersion.email,
        father_name       : oldVersion.father_name,
        father_phone      : oldVersion.father_phone,
        father_occupation : oldVersion.father_occupation,
        mother_name       : oldVersion.mother_name,
        mother_phone      : oldVersion.mother_phone,
        mother_email      : oldVersion.mother_email,
        parent_email      : oldVersion.parent_email,
        emergency_contact : oldVersion.emergency_contact,
        blood_group       : oldVersion.blood_group,
        medical_notes     : oldVersion.medical_notes,
        photo_path        : oldVersion.photo_path,

        // Carry forward SVA expansion fields
        village: oldVersion.village,
        police_station: oldVersion.police_station,
        post_office: oldVersion.post_office,
        district: oldVersion.district,
        whatsapp_no: oldVersion.whatsapp_no,
        nationality: oldVersion.nationality,
        religion: oldVersion.religion,
        caste: oldVersion.caste,
        mother_tongue: oldVersion.mother_tongue,
        identification_marks: oldVersion.identification_marks,
        is_hostel: oldVersion.is_hostel,
        medium: oldVersion.medium,
        pen_no: oldVersion.pen_no,
        apaar_id: oldVersion.apaar_id,
        prev_attendance_days: oldVersion.prev_attendance_days,
        distance_km: oldVersion.distance_km,
        father_qualification: oldVersion.father_qualification,
        father_aadhar: oldVersion.father_aadhar,
        father_annual_income: oldVersion.father_annual_income,
        mother_qualification: oldVersion.mother_qualification,
        mother_aadhar: oldVersion.mother_aadhar,
        mother_annual_income: oldVersion.mother_annual_income,
        guardian_name: oldVersion.guardian_name,
        guardian_relation: oldVersion.guardian_relation,
        guardian_phone: oldVersion.guardian_phone,
        guardian_occupation: oldVersion.guardian_occupation,
        guardian_qualification: oldVersion.guardian_qualification,
        guardian_aadhar: oldVersion.guardian_aadhar,
        guardian_annual_income: oldVersion.guardian_annual_income,

        // Carry forward permanent address fields
        is_permanent_same: oldVersion.is_permanent_same,
        perm_address: oldVersion.perm_address,
        perm_village: oldVersion.perm_village,
        perm_police_station: oldVersion.perm_police_station,
        perm_post_office: oldVersion.perm_post_office,
        perm_district: oldVersion.perm_district,
        perm_city: oldVersion.perm_city,
        perm_state: oldVersion.perm_state,
        perm_pincode: oldVersion.perm_pincode,

        // Overlay with incoming changes
        ...sanitizedNewData,
        // Versioning metadata
        valid_from    : today,
        valid_to      : null,
        is_current    : true,
        changed_by    : changedBy || null,
        change_reason : changeReason,
      }, { transaction: t });

      // ── Step 7: Write audit log entries (one per changed field) ─────
      await auditLogger.setContext(sequelize, {
        changedBy,
        reason     : changeReason,
        ipAddress,
        deviceInfo,
      }, t);

      // Determine which fields actually changed and log each one
      const watchedFields = [
        'address','city','state','pincode','phone','email',
        'father_name','father_phone','father_occupation',
        'mother_name','mother_phone','mother_email','parent_email',
        'emergency_contact','blood_group','medical_notes','photo_path',
        'village', 'police_station', 'post_office', 'district', 'whatsapp_no',
        'nationality', 'religion', 'caste', 'mother_tongue', 'identification_marks',
        'is_hostel', 'medium', 'pen_no', 'apaar_id', 'prev_attendance_days', 'distance_km',
        'father_qualification', 'father_aadhar', 'father_annual_income',
        'mother_qualification', 'mother_aadhar', 'mother_annual_income',
        'guardian_name', 'guardian_relation', 'guardian_phone', 'guardian_occupation',
        'guardian_qualification', 'guardian_aadhar', 'guardian_annual_income',
        'is_permanent_same', 'perm_address', 'perm_village', 'perm_police_station', 'perm_post_office', 'perm_district', 'perm_city', 'perm_state', 'perm_pincode'
      ];

      const auditRows = [];
      const now = new Date();

      for (const field of watchedFields) {
        const oldVal = oldVersion[field];
        const newVal = newVersion[field];
        // Only log fields that actually changed
        if (String(oldVal ?? '') !== String(newVal ?? '')) {
          auditRows.push({
            table_name  : 'student_profiles',
            record_id   : newVersion.id,
            field_name  : field,
            old_value   : oldVal !== null && oldVal !== undefined ? String(oldVal) : null,
            new_value   : newVal !== null && newVal !== undefined ? String(newVal) : null,
            changed_by  : changedBy || null,
            reason      : changeReason,
            ip_address  : ipAddress  || null,
            device_info : deviceInfo || null,
            created_at  : now,
          });
        }
      }

      if (auditRows.length > 0) {
        // Direct insert — auditLogger trigger is on students, not profiles.
        // We write profile audit rows manually here.
        await sequelize.getQueryInterface().bulkInsert('audit_logs', auditRows, { transaction: t });
      }

      return { oldVersion, newVersion };
    };

    return transaction ? work(transaction) : sequelize.transaction(work);
  },

  /**
   * Get the current profile for a student.
   */
  async getCurrent(studentId) {
    return StudentProfile.findOne({
      where: { student_id: studentId, is_current: true },
    });
  },

  /**
   * Get the profile as it was on a specific date.
   * @param {number} studentId
   * @param {string} date  - 'YYYY-MM-DD'
   */
  async getAsOf(studentId, date) {
    return StudentProfile.scope({ method: ['asOf', date] }).findOne({
      where: { student_id: studentId },
    });
  },

  /**
   * Get the full version history for a student, newest first.
   */
  async getHistory(studentId) {
    const [history] = await sequelize.query(`
      SELECT sp.*, u.name AS changed_by_name
      FROM student_profiles sp
      LEFT JOIN users u ON u.id = sp.changed_by
      WHERE sp.student_id = :studentId
      ORDER BY sp.valid_from DESC, sp.id DESC
    `, { replacements: { studentId } });
    return history;
  },
};

module.exports = profileVersioning;