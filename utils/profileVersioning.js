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
  async create({ studentId, data, changedBy, changeReason }) {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Sanitize data: convert empty strings to null for optional/enum fields
    const sanitizedData = {};
    Object.keys(data || {}).forEach(key => {
      sanitizedData[key] = data[key] === '' ? null : data[key];
    });

    const profile = await StudentProfile.create({
      student_id    : studentId,
      ...sanitizedData,
      valid_from    : today,
      valid_to      : null,
      is_current    : true,
      changed_by    : changedBy   || null,
      change_reason : changeReason || 'Initial profile created',
    });

    return profile;
  },

  /**
   * Update a student profile using the 7-step SCD-2 process.
   * Wrapped in a transaction — either all 7 steps succeed or none do.
   *
   * @returns {{ oldVersion: StudentProfile, newVersion: StudentProfile }}
   */
  async update({ studentId, newData, changedBy, changeReason, ipAddress, deviceInfo }) {

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

    const result = await sequelize.transaction(async (t) => {

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
        parent_email                  : oldVersion.parent_email,
        parent_password_hash          : oldVersion.parent_password_hash,
        parent_reset_password_token   : oldVersion.parent_reset_password_token,
        parent_reset_password_expires : oldVersion.parent_reset_password_expires,
        parent_last_login_at          : oldVersion.parent_last_login_at,
        parent_failed_login_attempts  : oldVersion.parent_failed_login_attempts,
        parent_locked_until           : oldVersion.parent_locked_until,
        emergency_contact : oldVersion.emergency_contact,
        blood_group       : oldVersion.blood_group,
        medical_notes     : oldVersion.medical_notes,
        photo_path        : oldVersion.photo_path,
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
    });

    return result;
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
    return StudentProfile.scope('allVersions').findAll({
      where   : { student_id: studentId },
      order   : [['valid_from', 'DESC'], ['id', 'DESC']],
    });
  },
};

module.exports = profileVersioning;