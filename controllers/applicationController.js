'use strict';

const sequelize = require('../config/database');
const bcrypt = require('bcryptjs');
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

    res.ok(application);
  } catch (err) { next(err); }
};

// ── PATCH /api/applications/:id/status ────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, remarks, admission_no, section_id, roll_number } = req.body;
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
      // Logic to convert to student
      const data = application.student_data;
      const { 
        first_name, last_name, email, date_of_birth, gender, aadhar_no,
        stream, joining_type, 
        previous_academic_records = [],
        ...profile 
      } = data;

      if (!admission_no) return res.fail('Admission number is required for approval.', [], 422);
      if (!section_id) return res.fail('Section assignment is required for approval.', [], 422);

      const studentEmail = email.trim().toLowerCase();
      const parentEmail = (profile.father_email || profile.mother_email || email).trim().toLowerCase();
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

        // 2. Parent / Family (Same logic as before)
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

        // 3. Create Student (Added aadhar_no)
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

        // 4. Enrollment (Same logic as before)
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
          'Transfer': 'transfer_in'
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

        // 6. Update Application
        await sequelize.query(`
          UPDATE applications 
          SET status = 'approved', updated_at = NOW() 
          WHERE id = :id;
        `, { replacements: { id }, transaction: t });

        return { studentId: student.id, admission_no, first_name, last_name, email: studentEmail, password: generatedPassword };
      });

      // Create profile version (outside transaction for cleaner logic if possible, or inside if you prefer)
      await profileVersioning.create({
        studentId: result.studentId,
        data: { ...profile, email: result.email },
        changedBy: req.user.id,
        changeReason: `Profile created from approved admission application (${application.reference_no})`,
      });

      invalidateCache(schoolId, '/api/students*');
      invalidateCache(schoolId, '/api/dashboard*');
      invalidateCache(schoolId, '/api/applications*');

      return res.ok(result, 'Application approved and student admitted.');
    } else {
      // Rejected
      await sequelize.query(`
        UPDATE applications 
        SET status = 'rejected', updated_at = NOW() 
        WHERE id = :id;
      `, { replacements: { id } });

      invalidateCache(schoolId, '/api/applications*');
      return res.ok(null, 'Application rejected.');
    }

  } catch (err) {
    console.error('--- ADMISSION APPROVAL ERROR ---');
    console.error('Error Name:', err.name);
    console.error('Error Message:', err.message);
    if (err.parent) console.error('DB Parent Error:', err.parent);
    console.error('Stack Trace:', err.stack);
    console.error('--------------------------------');

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
    await mailer.sendMail({
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
