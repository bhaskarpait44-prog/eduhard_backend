'use strict';

const sequelize = require('../config/database');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const profileVersioning = require('../utils/profileVersioning');
const { generateStudentPassword } = require('../utils/studentCredentials');
const { invalidateCache } = require('../middlewares/cache');

// ── GET /api/applications ────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const {
      status = 'pending',
      search = '',
      class_id = '',
      page = 1,
      perPage = 20,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(perPage, 10) || 20, 1);
    const offset = (pageNum - 1) * limitNum;

    const replacements = {
      schoolId,
      status,
      search: `%${search}%`,
      class_id: class_id || null,
      limit: limitNum,
      offset,
    };

    let whereClause = `
      a.school_id = :schoolId
      AND a.status = :status
      AND (
        :search = '%%'
        OR a.reference_no ILIKE :search
        OR (a.student_data->>'first_name') ILIKE :search
        OR (a.student_data->>'last_name') ILIKE :search
        OR (a.student_data->>'email') ILIKE :search
      )
    `;

    if (class_id) {
      whereClause += ` AND a.class_id = :class_id`;
    }

    const [[{ total }]] = await sequelize.query(`
      SELECT COUNT(*)::int AS total
      FROM applications a
      WHERE ${whereClause};
    `, { replacements });

    const [applications] = await sequelize.query(`
      SELECT 
        a.id, a.reference_no, a.status, a.student_data, a.created_at,
        a.class_id, a.session_id,
        c.name AS class_name, sess.name AS session_name
      FROM applications a
      LEFT JOIN classes c ON c.id = a.class_id
      LEFT JOIN sessions sess ON sess.id = a.session_id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT :limit OFFSET :offset;
    `, { replacements });

    res.ok({
      applications,
      meta: {
        page: pageNum,
        perPage: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      }
    });
  } catch (err) { next(err); }
};

// ── GET /api/applications/:id ─────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[application]] = await sequelize.query(`
      SELECT 
        a.*,
        c.name AS class_name,
        sess.name AS session_name
      FROM applications a
      LEFT JOIN classes c ON c.id = a.class_id
      LEFT JOIN sessions sess ON sess.id = a.session_id
      WHERE a.id = :id AND a.school_id = :schoolId;
    `, { replacements: { id, schoolId } });

    if (!application) return res.fail('Application not found.', [], 404);

    res.ok({ application });
  } catch (err) { next(err); }
};

// ── GET /api/applications/:id/documents/:key ─────────────────────────────────
exports.streamDocument = async (req, res, next) => {
  try {
    const { id, key } = req.params;
    const schoolId = req.user.school_id;

    const [[application]] = await sequelize.query(`
      SELECT student_data FROM applications WHERE id = :id AND school_id = :schoolId;
    `, { replacements: { id, schoolId } });

    if (!application) return res.fail('Application not found.', [], 404);

    const docPath = application.student_data.documents?.[key];
    if (!docPath) return res.fail('Document not found.', [], 404);

    // Resolve to absolute path, then verify it stays inside the uploads directory
    const UPLOADS_BASE = path.resolve(__dirname, '..', 'uploads');
    const fullPath = path.resolve(UPLOADS_BASE, docPath);

    if (!fullPath.startsWith(UPLOADS_BASE + path.sep)) {
      return res.fail('Access denied.', [], 403);
    }

    if (!fs.existsSync(fullPath)) return res.fail('File not found on server.', [], 404);

    res.sendFile(fullPath);
  } catch (err) { next(err); }
};

// ── GET /api/applications/next-admission-no ─────────────────────────────────
exports.getNextAdmissionNumber = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const year = new Date().getFullYear();
    const prefix = `ADM-${year}-`;

    const [[last]] = await sequelize.query(`
      SELECT admission_no 
      FROM students 
      WHERE school_id = :schoolId 
        AND admission_no LIKE :pattern
      ORDER BY id DESC 
      LIMIT 1;
    `, { replacements: { schoolId, pattern: `${prefix}%` } });

    let nextNum = 1001;
    if (last && last.admission_no) {
      const parts = last.admission_no.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }

    res.ok({ next_admission_no: `${prefix}${nextNum}` });
  } catch (err) { next(err); }
};

// ── PATCH /api/applications/:id/status ────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;
    const schoolId = req.user.school_id;

    if (!['approved', 'rejected'].includes(status)) {
      return res.fail('Invalid status. Use approved or rejected.', [], 400);
    }

    const [[application]] = await sequelize.query(`
      SELECT * FROM applications WHERE id = :id AND school_id = :schoolId;
    `, { replacements: { id, schoolId } });

    if (!application) return res.fail('Application not found.', [], 404);
    if (application.status !== 'pending') {
      return res.fail(`Application is already ${application.status}.`, [], 400);
    }

    if (status === 'approved') {
      await sequelize.query(`
        UPDATE applications 
        SET status = 'approved', 
            reviewed_by = :userId,
            reviewed_at = NOW(),
            remarks = :remarks,
            updated_at = NOW() 
        WHERE id = :id;
      `, { replacements: { id, userId: req.user.id, remarks: remarks || 'Application Approved' } });

      // Notify Applicant
      const email = application.student_data.email || application.student_data.father_email;
      if (email) {
        try {
          await require('../utils/emailService').sendEmail({
            to: email,
            subject: 'Admission Application Approved',
            html: `
              <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #2e7d32;">Application Approved!</h2>
                <p>Congratulations <strong>${application.student_data.first_name} ${application.student_data.last_name}</strong>,</p>
                <p>Your admission application (Ref: ${application.reference_no}) has been approved.</p>
                <p>Please visit the school office to complete the admission process.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #999;">This is an automated notification. Please do not reply.</p>
              </div>
            `
          });
        } catch (e) { console.error('Notify fail:', e) }
      }

      invalidateCache(schoolId, '/api/applications*');
      res.ok(null, 'Application approved and applicant notified.');

    } else {
      // Rejection logic with audit trail and notification
      await sequelize.query(`
        UPDATE applications 
        SET status = 'rejected', 
            reviewed_by = :userId,
            reviewed_at = NOW(),
            remarks = :remarks,
            updated_at = NOW() 
        WHERE id = :id;
      `, { replacements: { id, userId: req.user.id, remarks: remarks || 'Criteria not met' } });

      // Notify Applicant
      const parentEmail = (application.student_data.father_email || application.student_data.email);
      if (parentEmail) {
        try {
          await require('../utils/emailService').sendEmail({
            to: parentEmail,
            subject: `Admission Application Update - Ref: ${application.reference_no}`,
            html: `
              <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #d32f2f;">Application Status: Rejected</h2>
                <p>Dear Parent/Guardian,</p>
                <p>We regret to inform you that the admission application for <strong>${application.student_data.first_name} ${application.student_data.last_name}</strong> (Ref: ${application.reference_no}) has been rejected.</p>
                <p><strong>Reason:</strong> ${remarks || 'Criteria not met'}</p>
                <p>If you have any questions, please contact the school office.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #999;">This is an automated notification. Please do not reply.</p>
              </div>
            `
          });
        } catch (e) { console.error('Notify fail:', e) }
      }

      invalidateCache(schoolId, '/api/applications*');
      return res.ok(null, 'Application rejected and notification sent.');
    }

  } catch (err) {
    next(err);
  }
};

// ── POST /api/applications/:id/admit ──────────────────────────────────────────
exports.admitStudent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { admission_no, section_id, roll_number } = req.body;
    const schoolId = req.user.school_id;

    const [[application]] = await sequelize.query(`
      SELECT * FROM applications WHERE id = :id AND school_id = :schoolId;
    `, { replacements: { id, schoolId } });

    if (!application) return res.fail('Application not found.', [], 404);
    if (application.status !== 'approved') {
      return res.fail('Only approved applications can be admitted.', [], 400);
    }

    // Logic to convert to student
    const data = application.student_data;
    const { 
      first_name, last_name, email, date_of_birth, gender, aadhar_no,
      stream, joining_type, 
      previous_academic_records = [],
      ...profile 
    } = data;

    if (!admission_no) return res.fail('Admission number is required.', [], 422);
    if (!section_id) return res.fail('Section assignment is required.', [], 422);

    const studentEmail = (email || '').trim().toLowerCase();
    const parentEmail = (profile.father_email || profile.mother_email || email || '').trim().toLowerCase();
    const parentName = profile.father_name || profile.mother_name || `${last_name} Family`;
    const parentPhone = profile.father_phone || profile.mother_phone || profile.phone;

    const generatedPassword = generateStudentPassword();
    const studentHash = await bcrypt.hash(generatedPassword, 12);
    
    const generatedParentPassword = generateStudentPassword();
    const parentHash = await bcrypt.hash(generatedParentPassword, 12);

    const result = await sequelize.transaction(async (t) => {
      // 1. Check uniqueness
      const [[existing]] = await sequelize.query(`
        SELECT id FROM students WHERE school_id = :schoolId AND admission_no = :admission_no LIMIT 1;
      `, { replacements: { schoolId, admission_no }, transaction: t });

      if (existing) throw Object.assign(new Error('Admission number already exists.'), { status: 409 });

      // 2. Parent / Family
      let parentUserId;
      const [[existingParentUser]] = await sequelize.query(`
        SELECT id FROM users WHERE email = :email AND school_id = :schoolId LIMIT 1;
      `, { replacements: { email: parentEmail, schoolId }, transaction: t });

      if (existingParentUser) {
        parentUserId = existingParentUser.id;
      } else {
        const [[newParent]] = await sequelize.query(`
          INSERT INTO users (school_id, name, email, password_hash, role, is_active, created_at, updated_at)
          VALUES (:schoolId, :name, :email, :hash, 'parent', true, NOW(), NOW())
          RETURNING id;
        `, {
          replacements: { schoolId, name: parentName, email: parentEmail, hash: parentHash },
          transaction: t
        });
        parentUserId = newParent.id;
      }

      let familyId;
      const [[existingFamily]] = await sequelize.query(`
        SELECT id FROM families WHERE user_id = :parentUserId AND school_id = :schoolId LIMIT 1;
      `, { replacements: { parentUserId, schoolId }, transaction: t });

      if (existingFamily) {
        familyId = existingFamily.id;
      } else {
        const [[newFamily]] = await sequelize.query(`
          INSERT INTO families (school_id, user_id, family_name, primary_contact, phone, email, created_at, updated_at)
          VALUES (:schoolId, :parentUserId, :familyName, :primaryContact, :phone, :email, NOW(), NOW())
          RETURNING id;
        `, {
          replacements: { 
            schoolId, parentUserId, familyName: parentName, 
            primaryContact: parentName, phone: parentPhone, email: parentEmail 
          },
          transaction: t
        });
        familyId = newFamily.id;
      }

      // 3. Create Student
      const [[student]] = await sequelize.query(`
        INSERT INTO students (
          school_id, family_id, admission_no, first_name, last_name, 
          date_of_birth, gender, aadhar_no, password_hash, is_active, 
          last_password_change, is_deleted, created_at, updated_at
        )
        VALUES (
          :schoolId, :familyId, :admission_no, :first_name, :last_name, 
          :date_of_birth, :gender, :aadhar_no, :studentHash, true, 
          NOW(), false, NOW(), NOW()
        )
        RETURNING id;
      `, {
        replacements: {
          schoolId, familyId, admission_no, first_name, last_name, 
          date_of_birth, gender, aadhar_no: aadhar_no || null, studentHash,
        },
        transaction: t,
      });

      // 4. Enrollment
      let rollNo = roll_number;
      if (!rollNo) {
        const [[maxRoll]] = await sequelize.query(`
          SELECT MAX(CAST(roll_number AS INTEGER)) AS max_roll
          FROM enrollments
          WHERE section_id = :section_id
            AND session_id = :sessionId
            AND status = 'active'
            AND roll_number ~ '^\\d+$';
        `, { 
          replacements: { section_id, sessionId: application.session_id },
          transaction: t
        });
        rollNo = String((parseInt(maxRoll?.max_roll) || 0) + 1);
      }

      const joiningTypeMap = {
        'New Admission': 'fresh',
        'Transfer': 'transfer_in',
        'Re-admission': 're_admission',
        'Lateral Entry': 'lateral_entry'
      };
      const mappedJoiningType = joiningTypeMap[joining_type] || 'fresh';
      const mappedStream = (stream || 'regular').toLowerCase();

      await sequelize.query(`
        INSERT INTO enrollments
          (student_id, session_id, class_id, section_id, stream, roll_number, joined_date,
           joining_type, status, created_at, updated_at)
        VALUES
          (:studentId, :sessionId, :classId, :section_id, :stream, :rollNumber, CURRENT_DATE,
           :joiningType, 'active', NOW(), NOW())
      `, {
        replacements: {
          studentId: student.id,
          sessionId: application.session_id,
          classId: application.class_id,
          section_id,
          stream: mappedStream,
          rollNumber: rollNo,
          joiningType: mappedJoiningType,
        },
        transaction: t,
      });

      // 5. Previous Academic Records
      if (Array.isArray(previous_academic_records) && previous_academic_records.length > 0) {
        const records = previous_academic_records.map(r => ({
          student_id: student.id,
          school_name: r.school_name,
          location: r.location,
          class_name: r.class_name,
          year_of_study: r.year_of_study,
          percentage_grade: r.percentage_grade,
          created_at: new Date(),
          updated_at: new Date()
        }));
        await sequelize.getQueryInterface().bulkInsert('student_previous_academic_records', records, { transaction: t });
      }

      // 6. Update Application status to 'admitted'
      await sequelize.query(`
        UPDATE applications 
        SET status = 'admitted', 
            admitted_by = :userId,
            admitted_at = NOW(),
            updated_at = NOW() 
        WHERE id = :id;
      `, { replacements: { id, userId: req.user.id }, transaction: t });

      return { studentId: student.id, admission_no, first_name, last_name, email: studentEmail, password: generatedPassword };
    });

    // Notify Applicant
    if (result.email) {
      try {
        await require('../utils/emailService').sendEmail({
          to: result.email,
          subject: 'Admission Process Complete',
          html: `
            <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
              <h2 style="color: #2e7d32;">Welcome to the School!</h2>
              <p>Congratulations <strong>${result.first_name} ${result.last_name}</strong>,</p>
              <p>Your admission process is complete. Your account has been created with the following credentials:</p>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>Admission No:</strong> ${result.admission_no}</p>
                <p style="margin: 5px 0;"><strong>Password:</strong> ${result.password}</p>
              </div>
              <p>Please log in to the student portal to access your dashboard.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="font-size: 12px; color: #999;">This is an automated notification. Please change your password after logging in.</p>
            </div>
          `
        });
      } catch (e) { console.error('Notify fail:', e) }
    }

    invalidateCache(schoolId, '/api/applications*');
    res.ok(result, 'Student admitted successfully.');

  } catch (err) {
    if (err.name === 'CustomError') return res.fail(err.message, [], err.status || 400);
    next(err);
  }
};

// ── POST /api/applications/:id/email ─────────────────────────────────────────
exports.sendEmail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subject, message } = req.body;
    const schoolId = req.user.school_id;

    if (!subject || !message) {
      return res.fail('Subject and message are required.', [], 422);
    }

    const [[application]] = await sequelize.query(`
      SELECT reference_no, student_data FROM applications WHERE id = :id AND school_id = :schoolId;
    `, { replacements: { id, schoolId } });

    if (!application) return res.fail('Application not found.', [], 404);

    const email = application.student_data.email;
    const name = `${application.student_data.first_name} ${application.student_data.last_name}`;

    const mailer = require('../utils/mailer');
    await mailer.sendEmail({
      to: email,
      subject: `[${application.reference_no}] ${subject}`,
      text: `Dear ${name},\n\n${message}\n\nRegards,\nAdmissions Team\n${req.user.school_name || 'The School'}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #4f46e5;">Admission Update</h2>
          <p>Dear <strong>${name}</strong>,</p>
          <p style="white-space: pre-wrap; line-height: 1.6;">${message}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #666;">
            Reference: ${application.reference_no}<br>
            Please do not reply to this automated email.
          </p>
        </div>
      `
    });

    res.ok(null, 'Email sent successfully.');
  } catch (err) { next(err); }
};
