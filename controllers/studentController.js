'use strict';

const sequelize        = require('../config/database');
const redis            = require('../config/redis');
const bcrypt           = require('bcryptjs');
const auditLogger      = require('../utils/auditLogger');
const profileVersioning = require('../utils/profileVersioning');
const { generateStudentPassword } = require('../utils/studentCredentials');
const { invalidateCache } = require('../middlewares/cache');
const { getAttendancePercent } = require('../utils/attendanceCalculator');

// ── GET /api/students ────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const {
      search = '',
      class_id = '',
      section_id = '',
      session_id = '',
      status = '',
      gender = '',
      page = 1,
      perPage = 20,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(perPage, 10) || 20, 1);
    const offset = (pageNum - 1) * limitNum;

    const [classColumns] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'classes';
    `);
    const hasDisplayName = classColumns.some(col => col.column_name === 'display_name');
    const classLabelSelect = hasDisplayName
      ? `COALESCE(NULLIF(c.display_name, ''), c.name)`
      : 'c.name';

    let statusFilter = '';
    if (status === 'active') {
      statusFilter = "AND s.status = 'active' AND s.is_active = true";
    } else if (status === 'suspended') {
      statusFilter = "AND s.status = 'active' AND s.is_active = false";
    } else if (status === 'left') {
      statusFilter = "AND s.status = 'left'";
    } else if (status === 'graduated') {
      statusFilter = "AND s.status = 'graduated'";
    }

    const replacements = {
      schoolId,
      search: `%${search}%`,
      class_id: class_id || null,
      section_id: section_id || null,
      session_id: session_id || null,
      gender: gender || null,
      limit: limitNum,
      offset,
    };

    const whereClause = `
      s.school_id = :schoolId
      AND s.is_deleted = false
      AND (
        :search = '%%'
        OR s.first_name ILIKE :search
        OR s.last_name ILIKE :search
        OR s.admission_no ILIKE :search
        OR CONCAT(s.first_name, ' ', s.last_name) ILIKE :search
        OR p.phone ILIKE :search
        OR p.father_phone ILIKE :search
        OR p.mother_phone ILIKE :search
      )
      AND (
        (:class_id IS NULL AND :section_id IS NULL AND :session_id IS NULL)
        OR e.id IS NOT NULL
      )
      ${statusFilter}
      AND (:gender IS NULL OR s.gender = :gender)
    `;

    const [[{ total }]] = await sequelize.query(`
      SELECT COUNT(DISTINCT s.id)::int AS total
      FROM students s
      LEFT JOIN student_profiles p ON p.student_id = s.id AND p.is_current = true
      LEFT JOIN LATERAL (
        SELECT
          en.id,
          en.class_id,
          en.section_id,
          en.session_id
        FROM enrollments en
        WHERE en.student_id = s.id
          AND (:class_id IS NULL OR en.class_id = CAST(:class_id AS INTEGER))
          AND (:section_id IS NULL OR en.section_id = CAST(:section_id AS INTEGER))
          AND (:session_id IS NULL OR en.session_id = CAST(:session_id AS INTEGER))
        ORDER BY CASE WHEN en.status = 'active' THEN 0 ELSE 1 END, en.joined_date DESC, en.id DESC
        LIMIT 1
      ) e ON true
      WHERE ${whereClause};
    `, { replacements });

    const [students] = await sequelize.query(`
      SELECT
        s.id,
        s.admission_no,
        s.first_name,
        s.last_name,
        s.date_of_birth,
        s.gender,
        s.status,
        s.is_active,
        s.is_deleted,
        p.photo_path,
        e.id AS enrollment_id,
        e.class_id,
        e.section_id,
        e.session_id,
        e.stream,
        e.roll_number,
        e.joined_date,
        e.enrollment_status,
        e.class_name AS class,
        e.section_name AS section,
        e.session_name AS session
      FROM students s
      LEFT JOIN student_profiles p ON p.student_id = s.id AND p.is_current = true
      LEFT JOIN LATERAL (
        SELECT
          en.id,
          en.class_id,
          en.section_id,
          en.session_id,
          en.stream,
          en.roll_number,
          en.joined_date,
          en.status AS enrollment_status,
          ${classLabelSelect} AS class_name,
          sec.name AS section_name,
          sess.name AS session_name
        FROM enrollments en
        LEFT JOIN classes c ON c.id = en.class_id
        LEFT JOIN sections sec ON sec.id = en.section_id
        LEFT JOIN sessions sess ON sess.id = en.session_id
        WHERE en.student_id = s.id
          AND (:class_id IS NULL OR en.class_id = CAST(:class_id AS INTEGER))
          AND (:section_id IS NULL OR en.section_id = CAST(:section_id AS INTEGER))
          AND (:session_id IS NULL OR en.session_id = CAST(:session_id AS INTEGER))
        ORDER BY CASE WHEN en.status = 'active' THEN 0 ELSE 1 END, en.joined_date DESC, en.id DESC
        LIMIT 1
      ) e ON true
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT :limit OFFSET :offset;
    `, { replacements });

    const formatted = await Promise.all(students.map(async (student) => {
      let is_online = false;
      if (redis.status === 'ready') {
        const key = `online:${schoolId}:student:${student.id}`;
        const val = await redis.get(key);
        is_online = val === '1';
      }

      return {
        id: student.id,
        admission_no: student.admission_no,
        first_name: student.first_name,
        last_name: student.last_name,
        date_of_birth: student.date_of_birth,
        gender: student.gender,
        status: student.status,
        is_active: student.is_active,
        is_deleted: student.is_deleted,
        photo_path: student.photo_path,
        is_online,
        enrollment_id: student.enrollment_id || null,
        roll_number: student.roll_number || null,
        current_enrollment: student.enrollment_id
          ? {
              id: student.enrollment_id,
              class_id: student.class_id,
              section_id: student.section_id,
              session_id: student.session_id,
              class: student.class,
              section: student.section,
              session: student.session,
              stream: student.stream,
              roll_number: student.roll_number,
              joined_date: student.joined_date,
              status: student.enrollment_status,
            }
          : null,
      };
    }));

    res.ok({
      students: formatted,
      meta: {
        page: pageNum,
        perPage: limitNum,
        total,
        totalPages: Math.max(Math.ceil(total / limitNum), 1),
      },
    }, `${formatted.length} student(s) found.`);
  } catch (err) { next(err); }
};

// ── POST /api/students ────────────────────────────────────────────────────────
exports.admit = async (req, res, next) => {
  try {
    let {
      admission_no, first_name, last_name, date_of_birth, gender, aadhar_no,
      profile, password, parent_password
    } = req.body;
    
    // If multipart/form-data used, profile might be a JSON string
    if (typeof profile === 'string') {
      try { profile = JSON.parse(profile); } catch (e) { /* ignore */ }
    }

    // Server-side validation (mirrors frontend Zod rules)
    if (!first_name?.trim() || first_name.trim().length < 2)
      return res.fail('First name must be at least 2 characters.', [], 422);
    if (!last_name?.trim())
      return res.fail('Last name is required.', [], 422);
    if (!date_of_birth || new Date(date_of_birth) >= new Date())
      return res.fail('Date of birth must be in the past.', [], 422);
    if (!['male', 'female', 'other'].includes(gender))
      return res.fail('Gender must be male, female, or other.', [], 422);
    if (!admission_no?.trim())
      return res.fail('Admission number is required.', [], 422);
    if (!/^[a-zA-Z0-9\-_]+$/.test(admission_no.trim()))
      return res.fail('Admission number contains invalid characters.', [], 422);
    if (aadhar_no && !/^\d{12}$/.test(aadhar_no))
      return res.fail('Aadhaar number must be exactly 12 digits.', [], 422);

    // Validate emergency contact, father's phone, and other phone numbers
    const emergencyContact = profile?.emergency_contact;
    if (!emergencyContact?.trim()) {
      return res.fail('Emergency contact is required.', [], 422);
    }
    if (!/^[6-9]\d{9}$/.test(emergencyContact.trim())) {
      return res.fail('Emergency contact is invalid — enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.', [], 422);
    }

    const fatherPhone = profile?.father_phone;
    if (!fatherPhone?.trim()) {
      return res.fail("Father's phone is required.", [], 422);
    }
    if (!/^[6-9]\d{9}$/.test(fatherPhone.trim())) {
      return res.fail("Father's phone is invalid — enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.", [], 422);
    }

    const phoneFields = ['phone', 'whatsapp_no', 'mother_phone', 'guardian_phone'];
    for (const field of phoneFields) {
      const val = profile?.[field];
      if (val && val.trim() !== '' && !/^[6-9]\d{9}$/.test(val.trim())) {
        return res.fail(`${field.replace('_', ' ')} is invalid — enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.`, [], 422);
      }
    }

    // Prevent student email and parent email being identical
    const studentEmail = profile?.email?.trim().toLowerCase();
    const parentEmailCheck = (profile?.father_email || profile?.mother_email || profile?.email || profile?.parent_email)?.trim().toLowerCase();
    if (studentEmail && parentEmailCheck && studentEmail === parentEmailCheck)
      return res.fail('Student email and parent email cannot be the same address.', [], 422);

    const schoolId = req.user.school_id;
    const parentEmail = parentEmailCheck;
    const parentName = profile?.father_name || profile?.mother_name || `${last_name} Family`;
    const parentPhone = profile?.father_phone || profile?.mother_phone || profile?.phone;

    if (!parentEmail) {
      return res.fail('Parent email is required for account creation.', [], 422);
    }

    const generatedPassword = password || generateStudentPassword();
    const studentHash = await bcrypt.hash(generatedPassword, 12);
    
    const generatedParentPassword = parent_password || generateStudentPassword();
    const parentHash = await bcrypt.hash(generatedParentPassword, 12);

    const result = await sequelize.transaction(async (t) => {
      // 1. Check Student Unique Constraints
      const [[existing]] = await sequelize.query(`
        SELECT id FROM students WHERE school_id = :schoolId AND admission_no = :admission_no LIMIT 1;
      `, { replacements: { schoolId, admission_no }, transaction: t });

      if (existing) throw Object.assign(new Error('Admission number already exists.'), { status: 409 });

      if (studentEmail) {
        const [[emailInUse]] = await sequelize.query(`
          SELECT sp.id
          FROM student_profiles sp
          JOIN students s ON s.id = sp.student_id
          WHERE s.school_id = :schoolId
            AND s.is_deleted = false
            AND sp.is_current = true
            AND LOWER(sp.email) = LOWER(:email)
          LIMIT 1;
        `, { replacements: { schoolId, email: studentEmail }, transaction: t });

        if (emailInUse) throw Object.assign(new Error('Student email already exists.'), { status: 409 });
      }

      // 2. Handle Parent User Account (Logic remains same)
      let parentUserId;
      let parentAccountCreated = false;
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
        parentAccountCreated = true;
      }

      // 3. Handle Family Record
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

      // 4. Create Student
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
        RETURNING id, admission_no, first_name, last_name, date_of_birth, gender, aadhar_no, status;
      `, {
        replacements: {
          schoolId, familyId, admission_no, first_name, last_name, 
          date_of_birth, gender, aadhar_no, studentHash,
        },
        transaction: t,
      });

      // 5. Save Documents if any
      let uploadedPhotoPath = null;
      if (req.files && Object.keys(req.files).length > 0) {
        for (const [fieldname, fileArr] of Object.entries(req.files)) {
          const file = fileArr[0];
          const filePath = file.path.replace(/\\/g, '/');
          
          if (fieldname === 'photo') {
            uploadedPhotoPath = filePath;
          }

          await sequelize.query(`
            INSERT INTO student_documents (
              student_id, name, document_type, file_path, file_type, file_size, uploaded_by, created_at, updated_at
            )
            VALUES (
              :student_id, :name, :document_type, :file_path, :file_type, :file_size, :uploaded_by, NOW(), NOW()
            )
          `, {
            replacements: {
              student_id: student.id,
              name: file.originalname,
              document_type: fieldname,
              file_path: filePath,
              file_type: file.mimetype,
              file_size: file.size,
              uploaded_by: req.user.id
            },
            transaction: t
          });
        }
      }

      // 6. Create initial profile version
      if (profile) {
        await profileVersioning.create({
          studentId    : student.id,
          data         : { 
            ...profile, 
            email: studentEmail,
            parent_email: parentEmail,
            photo_path: uploadedPhotoPath 
          },
          changedBy    : req.user.id,
          changeReason : 'Initial profile created on admission',
          transaction  : t
        });
      }

      return { student, parentAccountCreated, generatedParentPassword, parentEmail };
    });

    res.ok({
      ...result.student,
      login_credentials: {
        student: {
          email: studentEmail,
          admission_no,
          password: generatedPassword,
        },
        parent: {
          email: result.parentEmail,
          password: result.generatedParentPassword,
          is_new_account: result.parentAccountCreated
        }
      },
    }, 'Student admitted and parent account linked/created successfully.', 201);

    // Invalidate student list cache
    invalidateCache(schoolId, '/api/students*');
    invalidateCache(schoolId, '/api/dashboard*');
  } catch (err) { next(err); }
};

// ── GET /api/students/:id ─────────────────────────────────────────────────────
exports.getBulkIdCardsData = async (req, res, next) => {
  try {
    const { class_id, section_id, session_id } = req.query;
    const schoolId = req.user.school_id;

    if (!class_id || !session_id) {
      return res.fail('class_id and session_id are required.');
    }

    const [students] = await sequelize.query(`
      SELECT 
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url,
        e.roll_number,
        c.name AS class_name,
        sec.name AS section_name,
        sess.name AS session_name,
        sch.name AS school_name, sch.logo_url, sch.address AS school_address
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      JOIN enrollments e ON e.student_id = s.id
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      JOIN schools sch ON sch.id = s.school_id
      WHERE s.school_id = :schoolId 
        AND s.is_deleted = false 
        AND s.is_active = true
        AND e.class_id = :class_id
        AND (:section_id IS NULL OR e.section_id = :section_id)
        AND e.session_id = :session_id
        AND e.status = 'active'
      ORDER BY e.roll_number ASC, s.first_name ASC;
    `, { 
      replacements: { 
        schoolId, 
        class_id: parseInt(class_id), 
        section_id: section_id ? parseInt(section_id) : null,
        session_id: parseInt(session_id)
      } 
    });

    res.ok(students);
  } catch (err) { next(err); }
};

exports.getTcData = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[data]] = await sequelize.query(`
      SELECT
        s.id, s.admission_no, s.first_name, s.last_name, s.date_of_birth, s.gender, s.status AS student_status,
        s.left_date, s.leaving_reason, s.leaving_remarks,
        sp.father_name, sp.mother_name,
        e.roll_number, e.joined_date, e.left_date AS enrollment_left_date, e.joining_type, e.leaving_type, e.status AS enrollment_status,
        c.name AS class_name,
        sec.name AS section_name,
        sess.name AS session_name,
        sch.name AS school_name, sch.logo_url, sch.address AS school_address, sch.phone AS school_phone, sch.email AS school_email, sch.principal_name
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      JOIN enrollments e ON e.student_id = s.id
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      JOIN schools sch ON sch.id = s.school_id
      WHERE s.id = :id AND s.school_id = :schoolId AND s.is_deleted = false
      ORDER BY e.joined_date DESC
      LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!data) return res.fail('Student or Enrollment record not found.', [], 404);

    if (!['left', 'graduated'].includes(data.student_status)) {
      return res.fail('Transfer Certificate is only available for students who have left or graduated.', [], 400);
    }

    // Format for PDF compatibility
    const formattedData = {
      certificate_no: `TC-${data.admission_no}`,
      issued_date: new Date().toISOString(),
      status: 'active',
      school: {
        name: data.school_name,
        logo_url: data.logo_url,
        address: data.school_address,
        phone: data.school_phone,
        email: data.school_email,
        principal_name: data.principal_name
      },
      recipient: {
        name: `${data.first_name} ${data.last_name}`,
        father_name: data.father_name || 'N/A',
        admission_no: data.admission_no,
        class_name: data.class_name
      },
      extra_data: {
        leaving_date: data.left_date || data.enrollment_left_date || new Date().toISOString(),
        reason: data.leaving_reason || data.leaving_type || 'Completion of Studies',
        last_class: data.class_name,
        conduct: 'Good'
      }
    };

    res.ok(formattedData);
  } catch (err) { next(err); }
};

exports.getIdCardData = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[data]] = await sequelize.query(`
      SELECT
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url,
        e.roll_number,
        c.name AS class_name,
        sec.name AS section_name,
        sess.name AS session_name,
        sch.name AS school_name, sch.logo_url, sch.address AS school_address
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN sessions sess ON sess.id = e.session_id
      JOIN schools sch ON sch.id = s.school_id
      WHERE s.id = :id AND s.school_id = :schoolId AND s.is_deleted = false
      LIMIT 1;
    `, { replacements: { id, schoolId } });
    if (!data) return res.fail('Student not found.', [], 404);

    res.ok(data);
  } catch (err) { next(err); }
};

// ── Bulk Import Endpoints ──────────────────────────────────────────────────

// ── GET /api/students/import/template ─────────────────────────────────────
exports.downloadAdmissionTemplate = async (req, res, next) => {
  try {
    return res.ok({
      columns: [
        { key: 'first_name',      label: 'First Name *',      example: 'Rahul' },
        { key: 'last_name',       label: 'Last Name *',       example: 'Sharma' },
        { key: 'date_of_birth',   label: 'DOB (YYYY-MM-DD) *', example: '2015-05-15' },
        { key: 'gender',          label: 'Gender *',          example: 'male' },
        { key: 'aadhar_no',       label: 'Aadhar No',         example: '123456789012' },
        { key: 'admission_class', label: 'Admission Class *', example: 'Class 1' },
        { key: 'section',         label: 'Section *',         example: 'A' },
        { key: 'admission_date',  label: 'Admission Date *',  example: '2024-04-01' },
        { key: 'admission_no',    label: 'Admission No',      example: 'ADM-2024-0001' },
        { key: 'father_name',     label: 'Father Name',       example: 'Vijay Sharma' },
        { key: 'mother_name',     label: 'Mother Name',       example: 'Anjali Sharma' },
        { key: 'guardian_phone',  label: 'Guardian Phone',    example: '9876543210' },
        { key: 'address',         label: 'Address',           example: '123 Main St, Jorhat' },
        { key: 'blood_group',     label: 'Blood Group',       example: 'O+' },
        { key: 'religion',        label: 'Religion',          example: 'Hindu' },
        { key: 'caste',           label: 'Caste',             example: 'General' },
        { key: 'previous_school', label: 'Previous School',   example: 'Little Angels' },
      ],
      valid_values: {
        gender: ['male', 'female', 'other'],
        blood_group: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'],
      },
      notes: [
        'Fields marked * are required.',
        'Admission No will be auto-generated if left blank (ADM-YEAR-XXXX).',
        'Admission Class and Section names must match exactly with existing records.',
        'Admission Date will be used as the student\'s joined date.',
      ],
    });
  } catch (err) { next(err); }
};

// ── POST /api/students/import/preview ─────────────────────────────────────
exports.previewAdmission = async (req, res, next) => {
  try {
    const { rows = [] } = req.body;
    const schoolId = req.user.school_id;

    const results = [];
    const admissionNumbers = new Set();

    // Cache classes and sections for performance
    const [classes] = await sequelize.query(
      `SELECT id, name FROM classes WHERE school_id = :schoolId AND is_deleted = false`,
      { replacements: { schoolId } }
    );
    const classMap = new Map(classes.map(c => [c.name.toLowerCase(), c.id]));

    const [sections] = await sequelize.query(
      `SELECT s.id, s.name, s.class_id, c.name as class_name 
       FROM sections s 
       JOIN classes c ON c.id = s.class_id 
       WHERE c.school_id = :schoolId AND s.is_deleted = false`,
      { replacements: { schoolId } }
    );
    const sectionMap = new Map(); // Key: "classname|sectionname"
    sections.forEach(s => {
      sectionMap.set(`${s.class_name.toLowerCase()}|${s.name.toLowerCase()}`, s.id);
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      const errors = [];

      // Required fields
      if (!row.first_name?.trim()) errors.push('First name is required');
      if (!row.last_name?.trim()) errors.push('Last name is required');
      if (!row.date_of_birth) errors.push('Date of birth is required');
      else if (isNaN(Date.parse(row.date_of_birth))) errors.push('Invalid date of birth format (YYYY-MM-DD)');
      
      if (!row.gender?.trim()) errors.push('Gender is required');
      else if (!['male', 'female', 'other'].includes(row.gender.trim().toLowerCase())) {
        errors.push('Invalid gender. Use male, female, or other');
      }

      if (!row.admission_class?.trim()) errors.push('Admission class is required');
      else if (!classMap.has(row.admission_class.trim().toLowerCase())) {
        errors.push(`Class "${row.admission_class}" not found`);
      }

      if (!row.section?.trim()) errors.push('Section is required');
      else if (row.admission_class?.trim() && !sectionMap.has(`${row.admission_class.trim().toLowerCase()}|${row.section.trim().toLowerCase()}`)) {
        errors.push(`Section "${row.section}" not found in class "${row.admission_class}"`);
      }

      if (!row.admission_date) errors.push('Admission date is required');
      else if (isNaN(Date.parse(row.admission_date))) errors.push('Invalid admission date format (YYYY-MM-DD)');

      // Optional: Blood Group
      if (row.blood_group?.trim()) {
        const bg = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'];
        if (!bg.includes(row.blood_group.trim())) {
          errors.push('Invalid blood group');
        }
      }

      // Admission No uniqueness
      if (row.admission_no?.trim()) {
        const admNo = row.admission_no.trim();
        if (admissionNumbers.has(admNo)) {
          errors.push('Duplicate admission number in file');
        } else {
          admissionNumbers.add(admNo);
          const [[exists]] = await sequelize.query(
            `SELECT id FROM students WHERE school_id = :schoolId AND admission_no = :admNo AND is_deleted = false LIMIT 1`,
            { replacements: { schoolId, admNo } }
          );
          if (exists) errors.push('Admission number already exists in database');
        }
      }

      results.push({
        row_number: rowNum,
        data: row,
        errors,
        is_valid: errors.length === 0,
      });
    }

    const summary = {
      total: rows.length,
      valid: results.filter(r => r.is_valid).length,
      invalid: results.filter(r => !r.is_valid).length,
    };

    return res.ok({ results, summary });
  } catch (err) { next(err); }
};

// ── POST /api/students/import/confirm ─────────────────────────────────────
exports.confirmAdmission = async (req, res, next) => {
  try {
    const { rows = [] } = req.body; // Valid rows from review
    const schoolId = req.user.school_id;

    // Create job record
    const [[log]] = await sequelize.query(`
      INSERT INTO bulk_import_logs
        (school_id, import_type, total_rows, success_count, failed_count, status, imported_by, created_at, updated_at)
      VALUES (:schoolId, 'students', :total, 0, 0, 'processing', :userId, NOW(), NOW())
      RETURNING id;
    `, { replacements: { schoolId, total: rows.length, userId: req.user.id } });

    const jobId = log.id;

    // Process async
    setImmediate(async () => {
      let successCount = 0;
      const errorDetails = [];

      // Find current active session
      const [[session]] = await sequelize.query(
        `SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1`,
        { replacements: { schoolId } }
      );

      if (!session) {
        errorDetails.push({ row: 'GLOBAL', error: 'No active session found. Students admitted but NOT enrolled.' });
      }

      // Cache classes and sections
      const [classes] = await sequelize.query(
        `SELECT id, name FROM classes WHERE school_id = :schoolId AND is_deleted = false`,
        { replacements: { schoolId } }
      );
      const classMap = new Map(classes.map(c => [c.name.toLowerCase(), c.id]));

      const [sections] = await sequelize.query(
        `SELECT s.id, s.name, s.class_id, c.name as class_name 
         FROM sections s 
         JOIN classes c ON c.id = s.class_id 
         WHERE c.school_id = :schoolId AND s.is_deleted = false`,
        { replacements: { schoolId } }
      );
      const sectionMap = new Map();
      sections.forEach(s => {
        sectionMap.set(`${s.class_name.toLowerCase()}|${s.name.toLowerCase()}`, s.id);
      });

      for (const row of rows) {
        const t = await sequelize.transaction();
        try {
          // 1. Resolve Admission No
          let admNo = row.admission_no?.trim();
          if (!admNo) {
            // Lock the school record to serialize admission number generation
            await sequelize.query(`SELECT id FROM schools WHERE id = :schoolId FOR UPDATE`, { 
              replacements: { schoolId }, transaction: t 
            });

            const year = new Date(row.admission_date).getFullYear();
            const [[seq]] = await sequelize.query(
              `SELECT COUNT(*)::int + 1 as next_val FROM students WHERE school_id = :schoolId AND admission_no LIKE :pattern`,
              { 
                replacements: { schoolId, pattern: `ADM-${year}-%` },
                transaction: t
              }
            );
            admNo = `ADM-${year}-${String(seq.next_val).padStart(4, '0')}`;
          }

          // 2. Passwords
          const rawPassword = generateStudentPassword();
          const hash = await bcrypt.hash(rawPassword, 12);

          // 3. Create Student
          const [[student]] = await sequelize.query(`
            INSERT INTO students (
              school_id, admission_no, first_name, last_name, 
              date_of_birth, gender, aadhar_no, password_hash, is_active, 
              last_password_change, is_deleted, created_at, updated_at
            )
            VALUES (
              :schoolId, :admNo, :firstName, :lastName, 
              :dob, :gender, :aadhar_no, :hash, true, 
              NOW(), false, NOW(), NOW()
            )
            RETURNING id;
          `, {
            replacements: {
              schoolId, admNo, firstName: row.first_name.trim(), lastName: row.last_name.trim(),
              dob: row.date_of_birth, gender: row.gender.trim().toLowerCase(), 
              aadhar_no: row.aadhar_no || null, hash,
            },
            transaction: t,
          });

          // 4. Create Profile (v1)
          const profileData = {
            father_name: row.father_name || null,
            mother_name: row.mother_name || null,
            phone: row.guardian_phone || null,
            address: row.address || null,
            blood_group: row.blood_group || null,
            religion: row.religion || null,
            caste: row.caste || null,
            previous_school: row.previous_school || null,
            parent_email: (row.guardian_email || row.email || '').trim().toLowerCase() || null
          };

          await profileVersioning.create({
            studentId: student.id,
            data: profileData,
            changedBy: req.user.id,
            changeReason: 'Bulk admission import',
          }, { transaction: t });

          // 5. Handle Parent User and Family
          const parentEmail = profileData.parent_email;
          if (parentEmail) {
            let parentUserId;
            const [[existingParent]] = await sequelize.query(
              `SELECT id FROM users WHERE LOWER(email) = LOWER(:email) AND school_id = :schoolId LIMIT 1`,
              { replacements: { email: parentEmail, schoolId }, transaction: t }
            );

            if (existingParent) {
              parentUserId = existingParent.id;
            } else {
              const parentName = profileData.father_name || profileData.mother_name || `${row.last_name} Family`;
              const [[newParent]] = await sequelize.query(`
                INSERT INTO users (school_id, name, email, password_hash, role, is_active, created_at, updated_at)
                VALUES (:schoolId, :name, :email, :hash, 'parent', true, NOW(), NOW())
                RETURNING id;
              `, {
                replacements: { schoolId, name: parentName, email: parentEmail, hash: await bcrypt.hash(generateStudentPassword(), 12) },
                transaction: t
              });
              parentUserId = newParent.id;
            }

            let familyId;
            const [[existingFamily]] = await sequelize.query(
              `SELECT id FROM families WHERE user_id = :parentUserId AND school_id = :schoolId LIMIT 1`,
              { replacements: { parentUserId, schoolId }, transaction: t }
            );

            if (existingFamily) {
              familyId = existingFamily.id;
            } else {
              const familyName = profileData.father_name || profileData.mother_name || `${row.last_name} Family`;
              const [[newFamily]] = await sequelize.query(`
                INSERT INTO families (school_id, user_id, family_name, primary_contact, phone, email, created_at, updated_at)
                VALUES (:schoolId, :parentUserId, :familyName, :primaryContact, :phone, :email, NOW(), NOW())
                RETURNING id;
              `, {
                replacements: { 
                  schoolId, parentUserId, familyName, 
                  primaryContact: familyName, phone: profileData.phone, email: parentEmail 
                },
                transaction: t
              });
              familyId = newFamily.id;
            }

            await sequelize.query(`UPDATE students SET family_id = :familyId WHERE id = :studentId`, {
              replacements: { familyId, studentId: student.id },
              transaction: t
            });
          }

          // 6. Create Enrollment
          const classId = classMap.get(row.admission_class.trim().toLowerCase());
          const sectionId = sectionMap.get(`${row.admission_class.trim().toLowerCase()}|${row.section.trim().toLowerCase()}`);

          if (session && classId && sectionId) {
            // Lock the section to serialize roll number assignment
            await sequelize.query(`SELECT id FROM sections WHERE id = :sectionId FOR UPDATE`, {
              replacements: { sectionId }, transaction: t
            });

            // Auto-assign roll number
            const [[maxRoll]] = await sequelize.query(`
              SELECT MAX(CAST(roll_number AS INTEGER)) AS max_roll
              FROM enrollments
              WHERE section_id = :sectionId
                AND session_id = :sessionId
                AND status = 'active'
                AND roll_number ~ '^\\d+$';
            `, { 
              replacements: { sectionId, sessionId: session.id },
              transaction: t
            });
            const rollNumber = String((parseInt(maxRoll?.max_roll) || 0) + 1);

            await sequelize.query(`
              INSERT INTO enrollments
                (student_id, session_id, class_id, section_id, stream, roll_number, joined_date,
                 joining_type, status, created_at, updated_at)
              VALUES
                (:studentId, :sessionId, :classId, :sectionId, 'regular', :rollNumber, :joinedDate,
                 'new_admission', 'active', NOW(), NOW())
            `, {
              replacements: {
                studentId: student.id,
                sessionId: session.id,
                classId,
                sectionId,
                rollNumber,
                joinedDate: row.admission_date,
              },
              transaction: t,
            });
          }

          await t.commit();
          successCount++;
        } catch (err) {
          await t.rollback();
          errorDetails.push({ row: row.admission_no || `${row.first_name} ${row.last_name}`, error: err.message });
        }
      }

      // Update log completion
      await sequelize.query(`
        UPDATE bulk_import_logs SET
          success_count = :success,
          failed_count = :failed,
          error_details = :errors,
          status = 'completed',
          updated_at = NOW()
        WHERE id = :id;
      `, {
        replacements: {
          id: jobId,
          success: successCount,
          failed: rows.length - successCount,
          errors: JSON.stringify(errorDetails),
        },
      });
    });

    return res.ok({ job_id: jobId, message: 'Bulk admission started.' });
  } catch (err) { next(err); }
};

// ── GET /api/students/import/:jobId/status ────────────────────────────────
exports.getAdmissionStatus = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const [[log]] = await sequelize.query(
      `SELECT * FROM bulk_import_logs WHERE id = :id AND school_id = :schoolId AND import_type = 'students'`,
      { replacements: { id: jobId, schoolId: req.user.school_id } }
    );

    if (!log) return res.fail('Import job not found.', [], 404);
    return res.ok(log);
  } catch (err) { next(err); }
};

// ── Standard Student Endpoints ──────────────────────────────────────────────

exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [classColumns] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'classes';
    `);
    const hasDisplayName = classColumns.some(col => col.column_name === 'display_name');
    const classLabelSelect = hasDisplayName
      ? `COALESCE(NULLIF(c.display_name, ''), c.name)`
      : 'c.name';

    const [[student]] = await sequelize.query(`
      SELECT s.id, s.admission_no, s.first_name, s.last_name, s.date_of_birth, s.gender, s.aadhar_no,
             s.status, s.is_active, s.created_at, s.family_id, s.transport_stop_id,
             sp.address, sp.city, sp.state, sp.pincode, sp.phone, 
             sp.email AS email,
             sp.father_name, sp.father_phone, sp.mother_name, sp.mother_phone,
             sp.mother_email AS mother_email,
             sp.father_qualification, sp.father_aadhar, sp.father_annual_income,
             sp.mother_qualification, sp.mother_aadhar, sp.mother_annual_income,
             sp.guardian_name, sp.guardian_relation, sp.guardian_phone, sp.guardian_qualification,
             sp.guardian_occupation, sp.guardian_aadhar, sp.guardian_annual_income,
             sp.parent_email AS parent_email, 
             sp.whatsapp_no,
             sp.nationality, sp.religion, sp.caste, sp.mother_tongue,
             sp.identification_marks, sp.pen_no, sp.apaar_id,
             sp.is_hostel, sp.medium, sp.prev_attendance_days, sp.distance_km,
             sp.is_permanent_same, sp.perm_address, sp.perm_village, sp.perm_police_station,
             sp.perm_post_office, sp.perm_district, sp.perm_city, sp.perm_state, sp.perm_pincode,
             sp.village, sp.police_station, sp.post_office, sp.district,
             sp.father_occupation,
             sp.blood_group, sp.medical_notes, sp.photo_path, sp.emergency_contact,
             ts.name AS transport_stop, tr.name AS transport_route
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN transport_stops ts ON ts.id = s.transport_stop_id
      LEFT JOIN transport_routes tr ON tr.id = ts.route_id
      WHERE s.id = :id AND s.school_id = :schoolId AND s.is_deleted = false;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!student) return res.fail('Student not found.', [], 404);

    // Fetch siblings if family_id exists
    let siblings = [];
    if (student.family_id) {
      [siblings] = await sequelize.query(`
        SELECT s.id, s.admission_no, s.first_name, s.last_name, 
               c.name AS class_name, sec.name AS section_name
        FROM students s
        LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
        LEFT JOIN classes c ON c.id = e.class_id
        LEFT JOIN sections sec ON sec.id = e.section_id
        WHERE s.family_id = :familyId 
          AND s.id <> :studentId
          AND s.is_deleted = false
        ORDER BY s.first_name ASC;
      `, { replacements: { familyId: student.family_id, studentId: id } });
    }

    // Fetch active library issues
    const [libraryIssues] = await sequelize.query(`
      SELECT li.id, li.book_id, lb.title, lb.isbn, li.issue_date, li.due_date, li.return_date, li.status
      FROM library_issues li
      JOIN library_books lb ON lb.id = li.book_id
      WHERE li.borrower_id = :id AND li.borrower_type = 'student' AND li.status = 'issued'
      ORDER BY li.issue_date DESC;
    `, { replacements: { id } });

    // Current enrollment
    const [[enrollment]] = await sequelize.query(`
      SELECT
        e.id,
        e.class_id,
        e.section_id,
        e.session_id,
        e.stream,
        ${classLabelSelect} AS class,
        sec.name AS section,
        e.roll_number,
        e.joined_date,
        sess.name AS session,
        e.status
      FROM enrollments e
      JOIN classes  c   ON c.id   = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      WHERE e.student_id = :id
      ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.joined_date DESC, e.id DESC
      LIMIT 1;
    `, { replacements: { id } });

    // Check online status in Redis
    let is_online = false;
    if (redis.status === 'ready') {
      const key = `online:${req.user.school_id}:student:${id}`;
      const val = await redis.get(key);
      is_online = val === '1';
    }

    // Fetch documents
    const [documents] = await sequelize.query(`
      SELECT id, name, document_type, file_path, file_size, created_at
      FROM student_documents
      WHERE student_id = :id
      ORDER BY created_at DESC;
    `, { replacements: { id } });

    res.ok({ 
      ...student, 
      is_online, 
      current_enrollment: enrollment || null,
      siblings,
      library_issues: libraryIssues,
      documents
    }, 'Student retrieved.');
  } catch (err) { next(err); }
};

// ── PATCH /api/students/:id/identity ─────────────────────────────────────────
exports.updateIdentity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { admission_no, first_name, last_name, date_of_birth, gender, aadhar_no, reason } = req.body;

    // ── Validation Guards ─────────────────────────────────────────────
    if (first_name !== undefined && (!first_name?.trim() || first_name.trim().length < 2))
      return res.fail('First name must be at least 2 characters.', [], 422);
    if (last_name !== undefined && !last_name?.trim())
      return res.fail('Last name is required.', [], 422);
    if (date_of_birth !== undefined && (!date_of_birth || new Date(date_of_birth) >= new Date()))
      return res.fail('Date of birth must be in the past.', [], 422);
    if (gender !== undefined && !['male', 'female', 'other'].includes(gender))
      return res.fail('Gender must be male, female, or other.', [], 422);
    
    if (admission_no !== undefined) {
      if (!admission_no?.trim()) return res.fail('Admission number is required.', [], 422);
      if (!/^[a-zA-Z0-9\-_]+$/.test(admission_no.trim()))
        return res.fail('Admission number contains invalid characters.', [], 422);
    }

    if (aadhar_no && aadhar_no.trim() !== '' && !/^\d{12}$/.test(aadhar_no))
      return res.fail('Aadhaar number must be exactly 12 digits.', [], 422);
    // ──────────────────────────────────────────────────────────────────

    const [[student]] = await sequelize.query(`
      SELECT id, admission_no, first_name, last_name, date_of_birth, gender, aadhar_no
      FROM students WHERE id = :id AND school_id = :schoolId AND is_deleted = false;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!student) return res.fail('Student not found.', [], 404);

    if (admission_no && admission_no !== student.admission_no) {
      const [[existing]] = await sequelize.query(`
        SELECT id FROM students
        WHERE school_id = :schoolId
          AND admission_no = :admission_no
          AND id <> :id
        LIMIT 1;
      `, { replacements: { schoolId: req.user.school_id, admission_no, id } });

      if (existing) {
        return res.fail('Admission number already exists for this school.', [], 409);
      }
    }

    const updates = {};
    if (admission_no)  updates.admission_no  = admission_no;
    if (first_name)    updates.first_name    = first_name;
    if (last_name)     updates.last_name     = last_name;
    if (date_of_birth) updates.date_of_birth = date_of_birth;
    if (gender)        updates.gender        = gender;
    if (aadhar_no !== undefined) updates.aadhar_no = aadhar_no;

    if (Object.keys(updates).length === 0) {
      return res.fail('No fields provided to update.');
    }

    const updated = await sequelize.transaction(async (t) => {
      // Set audit context — trigger reads these for each field change
      await auditLogger.setContext(sequelize, {
        changedBy  : req.user.id,
        reason,
        ipAddress  : req.ip,
        deviceInfo : req.headers['user-agent'],
      }, t);

      const setClauses = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      const [[resRow]] = await sequelize.query(`
        UPDATE students SET ${setClauses}, updated_at = NOW()
        WHERE id = :id
        RETURNING id, admission_no, first_name, last_name, date_of_birth, gender, aadhar_no, is_active, status;
      `, { replacements: { ...updates, id }, transaction: t });

      return resRow;
    });

    if (updated) {
      res.ok(updated, 'Student identity updated. Audit log written.');

      // Invalidate student list and detail cache
      invalidateCache(req.user.school_id, '/api/students*');
      invalidateCache(req.user.school_id, '/api/dashboard*');
    }
  } catch (err) { next(err); }
};

// ── PATCH /api/students/:id/profile ──────────────────────────────────────────
exports.updateProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      change_reason, 
      first_name, last_name, admission_no, date_of_birth, gender, aadhar_no,
      ...newData 
    } = req.body;

    if (admission_no !== undefined) {
      if (!admission_no?.trim()) return res.fail('Admission number is required.', [], 422);
      if (!/^[a-zA-Z0-9\-_]+$/.test(admission_no.trim()))
        return res.fail('Admission number contains invalid characters.', [], 422);
    }

    if (!change_reason?.trim() || change_reason.trim().length < 5)
      return res.fail('A reason for the update is required (minimum 5 characters).', [], 422);

    // ── Validation Guards ─────────────────────────────────────────────
    if (first_name !== undefined && !first_name?.trim()) return res.fail('First name is required.', [], 422);
    if (last_name !== undefined && !last_name?.trim())  return res.fail('Last name is required.', [], 422);
    if (date_of_birth !== undefined && (!date_of_birth || new Date(date_of_birth) > new Date()))
      return res.fail('Date of birth must be in the past.', [], 422);
    if (gender !== undefined && !['male', 'female', 'other'].includes(gender))
      return res.fail('Gender must be male, female, or other.', [], 422);
    if (admission_no !== undefined) {
      if (!admission_no?.trim()) return res.fail('Admission number is required.', [], 422);
      if (!/^[a-zA-Z0-9\-_]+$/.test(admission_no.trim()))
        return res.fail('Admission number contains invalid characters.', [], 422);
    }
    if (aadhar_no && aadhar_no.trim() !== '' && !/^\d{12}$/.test(aadhar_no))
      return res.fail('Aadhaar must be exactly 12 digits.', [], 422);

    // Validate emergency contact, father's phone, and other phone numbers if provided
    const emergencyContact = newData.emergency_contact;
    if (emergencyContact !== undefined) {
      if (!emergencyContact?.trim()) {
        return res.fail('Emergency contact is required.', [], 422);
      }
      if (!/^[6-9]\d{9}$/.test(emergencyContact.trim())) {
        return res.fail('Emergency contact is invalid — enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.', [], 422);
      }
    }

    if (newData.father_phone !== undefined) {
      if (!newData.father_phone?.trim()) {
        return res.fail("Father's phone is required.", [], 422);
      }
      if (!/^[6-9]\d{9}$/.test(newData.father_phone.trim())) {
        return res.fail("Father's phone is invalid — enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.", [], 422);
      }
    }

    const phoneFields = ['phone', 'whatsapp_no', 'mother_phone', 'guardian_phone'];
    for (const field of phoneFields) {
      const val = newData[field];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        if (!/^[6-9]\d{9}$/.test(String(val).trim())) {
          return res.fail(`${field.replace('_', ' ')} is invalid — enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.`, [], 422);
        }
      }
    }

    // Get existing emails from current profile to verify update conflict
    const [[existingEmails]] = await sequelize.query(`
      SELECT sp.email, sp.parent_email 
      FROM student_profiles sp 
      WHERE sp.student_id = :id AND sp.is_current = true LIMIT 1;
    `, { replacements: { id } });

    const finalStudentEmail = (newData.email !== undefined ? newData.email : (existingEmails?.email || ''))?.trim().toLowerCase();
    const finalParentEmail = (newData.parent_email !== undefined ? newData.parent_email : (existingEmails?.parent_email || ''))?.trim().toLowerCase();

    if (finalStudentEmail && finalParentEmail && finalStudentEmail === finalParentEmail) {
      return res.fail('Student email and parent email cannot be the same address.', [], 422);
    }
    // ──────────────────────────────────────────────────────────────────

    const [[student]] = await sequelize.query(`
      SELECT * FROM students WHERE id = :id AND school_id = :schoolId AND is_deleted = false;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!student) return res.fail('Student not found.', [], 404);

    const result = await sequelize.transaction(async (t) => {
      // 1. Update Students table if identity fields provided
      const identityUpdates = {};
      if (first_name)    identityUpdates.first_name    = first_name;
      if (last_name)     identityUpdates.last_name     = last_name;
      if (admission_no)  identityUpdates.admission_no  = admission_no;
      if (date_of_birth) identityUpdates.date_of_birth = date_of_birth;
      if (gender)        identityUpdates.gender        = gender;
      if (aadhar_no !== undefined) identityUpdates.aadhar_no = aadhar_no;

      if (Object.keys(identityUpdates).length > 0) {
        // Check admission_no uniqueness if changed
        if (admission_no && admission_no !== student.admission_no) {
          const [[existing]] = await sequelize.query(`
            SELECT id FROM students WHERE school_id = :schoolId AND admission_no = :admission_no AND id <> :id LIMIT 1;
          `, { replacements: { schoolId: req.user.school_id, admission_no, id }, transaction: t });
          if (existing) throw Object.assign(new Error('Admission number already exists.'), { status: 409 });
        }

        const setClauses = Object.keys(identityUpdates).map(k => `${k} = :${k}`).join(', ');
        await sequelize.query(`
          UPDATE students SET ${setClauses}, updated_at = NOW() WHERE id = :id;
        `, { replacements: { ...identityUpdates, id }, transaction: t });
      }

      // 2. Update Student Profile (Versioned)
      await profileVersioning.update({
        studentId    : parseInt(id),
        newData,
        changedBy    : req.user.id,
        changeReason : change_reason,
        ipAddress    : req.ip,
        deviceInfo   : req.headers['user-agent'],
        transaction  : t
      });

      // Sync parent login email in users and families tables if parent_email was updated
      if (newData.parent_email) {
        const cleanEmail = newData.parent_email.trim().toLowerCase();
        await sequelize.query(`
          UPDATE users u
          SET email = :newEmail, updated_at = NOW()
          FROM families f
          JOIN students s ON s.family_id = f.id
          WHERE s.id = :studentId
            AND s.school_id = :schoolId
            AND f.user_id = u.id
            AND u.role = 'parent';
        `, {
          replacements: { newEmail: cleanEmail, studentId: parseInt(id), schoolId: req.user.school_id },
          transaction: t
        });

        await sequelize.query(`
          UPDATE families f
          SET email = :newEmail, updated_at = NOW()
          FROM students s
          WHERE s.id = :studentId
            AND s.school_id = :schoolId
            AND s.family_id = f.id;
        `, {
          replacements: { newEmail: cleanEmail, studentId: parseInt(id), schoolId: req.user.school_id },
          transaction: t
        });
      }

      // 3. Fetch full updated record (same logic as getById)
      const [[updated]] = await sequelize.query(`
        SELECT s.id, s.admission_no, s.first_name, s.last_name, s.date_of_birth, s.gender, s.aadhar_no,
               s.status, s.is_active, s.created_at, s.family_id, s.transport_stop_id,
               sp.address, sp.city, sp.state, sp.pincode, sp.phone, 
               sp.email AS email,
               sp.father_name, sp.father_phone, sp.mother_name, sp.mother_phone,
               sp.mother_email AS mother_email,
               sp.father_qualification, sp.father_aadhar, sp.father_annual_income,
               sp.mother_qualification, sp.mother_aadhar, sp.mother_annual_income,
               sp.guardian_name, sp.guardian_relation, sp.guardian_phone, sp.guardian_qualification,
               sp.guardian_occupation, sp.guardian_aadhar, sp.guardian_annual_income,
               sp.parent_email AS parent_email, 
               sp.whatsapp_no,
               sp.nationality, sp.religion, sp.caste, sp.mother_tongue,
               sp.identification_marks, sp.pen_no, sp.apaar_id,
               sp.is_hostel, sp.medium, sp.prev_attendance_days, sp.distance_km,
               sp.is_permanent_same, sp.perm_address, sp.perm_village, sp.perm_police_station,
               sp.perm_post_office, sp.perm_district, sp.perm_city, sp.perm_state, sp.perm_pincode,
               sp.village, sp.police_station, sp.post_office, sp.district,
               sp.father_occupation,
               sp.blood_group, sp.medical_notes, sp.photo_path, sp.emergency_contact
        FROM students s
        LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
        WHERE s.id = :id AND s.is_deleted = false;
      `, { replacements: { id }, transaction: t });

      return updated;
    });

    // 4. Fetch related data to ensure complete sync
    const [documents] = await sequelize.query(`
      SELECT id, name, document_type, file_path, file_size, created_at FROM student_documents WHERE student_id = :id;
    `, { replacements: { id } });

    res.ok({
      ...result,
      documents
    }, 'Student profile and identity updated. New version created.');

    // Invalidate student list and detail cache
    invalidateCache(req.user.school_id, '/api/students*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

// ── DELETE /api/students/:id ─────────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    const [[student]] = await sequelize.query(`
      SELECT s.id, s.admission_no, sp.email
      FROM students s
      LEFT JOIN student_profiles sp
        ON sp.student_id = s.id
       AND sp.is_current = true
      WHERE s.id = :id
        AND s.school_id = :schoolId
        AND s.is_deleted = false;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!student) return res.fail('Student not found.', [], 404);

    const rawPassword = (new_password || '').trim() || generateStudentPassword();
    const hash = await bcrypt.hash(rawPassword, 12);

    await sequelize.query(`
      UPDATE students
      SET password_hash = :hash,
          last_password_change = NOW(),
          updated_at = NOW(),
          failed_login_attempts = 0,
          locked_until = NULL
      WHERE id = :id;
    `, { replacements: { hash, id } });

    res.ok({
      admission_no: student.admission_no,
      email: student.email || null,
      generated_password: rawPassword,
    }, 'Student portal password reset successfully.');
  } catch (err) { next(err); }
};

exports.resetParentPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    const [[student]] = await sequelize.query(`
      SELECT sp.parent_email, sp.id AS profile_id
      FROM student_profiles sp
      JOIN students s ON s.id = sp.student_id
      WHERE s.id = :id
        AND s.school_id = :schoolId
        AND sp.is_current = true
        AND s.is_deleted = false;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!student || !student.parent_email) {
      return res.fail('Parent email not found for this student.', [], 404);
    }

    const rawPassword = (new_password || '').trim() || generateStudentPassword();
    const hash = await bcrypt.hash(rawPassword, 12);

    // Update ALL current profiles with this parent email in this school
    await sequelize.query(`
      UPDATE student_profiles sp
      SET parent_password_hash = :hash,
          parent_failed_login_attempts = 0,
          parent_locked_until = NULL
      FROM students s
      WHERE s.id = sp.student_id
        AND s.school_id = :schoolId
        AND sp.is_current = true
        AND LOWER(sp.parent_email) = LOWER(:parentEmail);
    `, { 
      replacements: { 
        hash, 
        schoolId: req.user.school_id, 
        parentEmail: student.parent_email 
      } 
    });

    res.ok({
      parent_email: student.parent_email,
      generated_password: rawPassword,
    }, 'Parent portal password reset successfully.');
  } catch (err) { next(err); }
};

exports.toggleStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT id, is_active, status FROM students WHERE id = :id AND school_id = :schoolId AND is_deleted = false;
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    if (student.status !== 'active') {
      return res.fail(`Cannot activate or deactivate a student who has ${student.status}. Use Re-admit to restore access.`, [], 400);
    }

    const newIsActive = !student.is_active;

    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        UPDATE students SET is_active = :newIsActive, updated_at = NOW() WHERE id = :id;
      `, { replacements: { newIsActive, id }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('students', :id, 'is_active', :oldValue, :newValue,
           :changedBy, :reason, :ip, :device, NOW())
      `, { replacements: {
        id,
        oldValue: String(student.is_active),
        newValue: String(newIsActive),
        changedBy: req.user.id,
        reason: `Student account ${newIsActive ? 'activated' : 'deactivated'}`,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });
    });

    res.ok({ is_active: newIsActive }, `Student account ${newIsActive ? 'activated' : 'deactivated'} successfully.`);

    // Invalidate student list and detail cache
    invalidateCache(schoolId, '/api/students*');
    invalidateCache(schoolId, '/api/dashboard*');
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { confirm_name, reason } = req.body;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT id, first_name, last_name
      FROM students
      WHERE id = :id AND school_id = :schoolId AND is_deleted = false;
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    const expectedName = `${student.first_name} ${student.last_name}`.trim();
    if ((confirm_name || '').trim() !== expectedName) {
      return res.fail('Typed student name does not match.', [], 400);
    }

    await sequelize.transaction(async (t) => {
      await auditLogger.setContext(sequelize, {
        changedBy  : req.user.id,
        reason     : reason || `Student deleted after confirming name ${expectedName}`,
        ipAddress  : req.ip,
        deviceInfo : req.headers['user-agent'],
      }, t);

      await sequelize.query(`
        UPDATE students
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :id AND school_id = :schoolId AND is_deleted = false;
      `, { replacements: { id, schoolId }, transaction: t });
    });

    res.ok({}, 'Student deleted successfully.');

    // Invalidate student list and detail cache
    invalidateCache(schoolId, '/api/students*');
    invalidateCache(schoolId, '/api/dashboard*');
  } catch (err) { next(err); }
};

// ── GET /api/students/:id/history ────────────────────────────────────────────
exports.getHistory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [classColumns] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'classes';
    `);
    const hasDisplayName = classColumns.some(col => col.column_name === 'display_name');
    const historyClassLabelSelect = hasDisplayName
      ? `COALESCE(NULLIF(cls.display_name, ''), cls.name)`
      : 'cls.name';

    // Full enrollment history chain
    const [enrollments] = await sequelize.query(`
      WITH RECURSIVE chain AS (
        SELECT e.*, 1 AS depth
        FROM enrollments e
        WHERE e.id = (
          SELECT en.id
          FROM enrollments en
          WHERE en.student_id = :id
          ORDER BY CASE WHEN en.status = 'active' THEN 0 ELSE 1 END, en.joined_date DESC, en.id DESC
          LIMIT 1
        )
        UNION ALL
        SELECT prev.*, c.depth + 1 FROM enrollments prev
        JOIN chain c ON c.previous_enrollment_id = prev.id
      )
      SELECT c.id, c.depth, c.class_id, c.section_id, c.session_id,
             sess.name AS session, ${historyClassLabelSelect} AS class,
             sec.name AS section, c.stream, c.roll_number, c.joining_type,
             c.leaving_type, c.joined_date, c.left_date, c.status
      FROM chain c
      JOIN sessions sess ON sess.id = c.session_id
      JOIN classes  cls  ON cls.id  = c.class_id
      JOIN sections sec  ON sec.id  = c.section_id
      ORDER BY c.depth DESC;
    `, { replacements: { id } });

    // Profile versions
    const profileHistory = await profileVersioning.getHistory(parseInt(id));

    // Exam results per session
    const [results] = await sequelize.query(`
      SELECT sr.percentage, sr.grade, sr.result, sr.is_promoted,
             sess.name AS session
      FROM student_results sr
      JOIN enrollments e ON e.id = sr.enrollment_id
      JOIN sessions sess ON sess.id = sr.session_id
      WHERE e.student_id = :id
      ORDER BY sess.start_date DESC;
    `, { replacements: { id } });

    res.ok({
      enrollment_history : enrollments,
      profile_history    : profileHistory,
      result_history     : results,
    }, 'Student history retrieved.');
  } catch (err) { next(err); }
};

const pdfGen           = require('../utils/pdfGenerator');
const { convertWebPToPng } = require('../utils/puppeteerPdf');

// ── GET /api/students/:id/admission-form ─────────────────────────────────────
exports.downloadAdmissionForm = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    // 1. Fetch Student and current Profile
    const [[student]] = await sequelize.query(`
      SELECT s.*, sp.photo_path
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      WHERE s.id = :id AND s.school_id = :schoolId AND s.is_deleted = false;
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    const [[profile]] = await sequelize.query(`
      SELECT * FROM student_profiles WHERE student_id = :id AND is_current = true;
    `, { replacements: { id } });

    // 2. Fetch School and Session info
    const [[school]] = await sequelize.query(`SELECT * FROM schools WHERE id = :schoolId;`, { replacements: { schoolId } });
    
    // Get latest enrollment
    const [[enrollment]] = await sequelize.query(`
      SELECT e.*, c.name AS class_name, sec.name AS section_name, sess.name AS session_name
      FROM enrollments e
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      WHERE e.student_id = :id
      ORDER BY e.joined_date DESC, e.id DESC
      LIMIT 1;
    `, { replacements: { id } });

    // Fetch Academic Records
    const [academicRecords] = await sequelize.query(`
      SELECT * FROM student_previous_academic_records WHERE student_id = :id ORDER BY created_at ASC;
    `, { replacements: { id } });

    // Handle WebP conversion if needed
    let photoBuffer = null;
    if (student.photo_path && student.photo_path.toLowerCase().endsWith('.webp')) {
      console.log('[PDF] Converting WebP photo for PDF...');
      photoBuffer = await convertWebPToPng(student.photo_path);
    }

    // 3. Generate PDF
    const pdfBuffer = await pdfGen.generateAdmissionForm({
      school,
      student,
      profile: profile || {},
      enrollment: enrollment || {},
      session: { name: enrollment?.session_name || 'N/A' },
      academicRecords,
      photoBuffer
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=AdmissionForm_${student.admission_no}.pdf`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
};

// ── Document Management ───────────────────────────────────────────────────

exports.getDocuments = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [docs] = await sequelize.query(`
      SELECT d.*, u.name AS uploader_name
      FROM student_documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.student_id = :id
      ORDER BY d.created_at DESC;
    `, { replacements: { id } });
    res.ok(docs);
  } catch (err) { next(err); }
};

exports.uploadDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, document_type } = req.body;

    if (!req.file) return res.fail('No file uploaded.');

    const [[doc]] = await sequelize.query(`
      INSERT INTO student_documents (
        student_id, name, document_type, file_path, file_type, file_size, uploaded_by, created_at, updated_at
      )
      VALUES (
        :student_id, :name, :document_type, :file_path, :file_type, :file_size, :uploaded_by, NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        student_id: id,
        name: name || req.file.originalname,
        document_type: document_type || 'other',
        file_path: req.file.path.replace(/\\/g, '/'), // Normalize Windows paths for URLs
        file_type: req.file.mimetype,
        file_size: req.file.size,
        uploaded_by: req.user.id
      }
    });

    res.ok(doc, 'Document uploaded successfully.', 201);
  } catch (err) { next(err); }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const { id, docId } = req.params;
    const [[doc]] = await sequelize.query(`
      SELECT id FROM student_documents WHERE id = :docId AND student_id = :id;
    `, { replacements: { docId, id } });

    if (!doc) return res.fail('Document not found.', [], 404);

    await sequelize.query(`DELETE FROM student_documents WHERE id = :docId;`, { replacements: { docId } });
    // In a real app, also delete the file from storage
    res.ok({}, 'Document deleted.');
  } catch (err) { next(err); }
};

// ── Results (Admin facing) ────────────────────────────────────────────────

const roundNumber = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

function gradeColor(grade) {
  if (grade === 'A+') return 'dark_green';
  if (grade === 'A') return 'green';
  if (grade === 'B') return 'teal';
  if (grade === 'C') return 'blue';
  if (grade === 'D') return 'amber';
  return 'red';
}

async function getFeeSummaryForAdmin(enrollmentId) {
  const [[summary]] = await sequelize.query(`
    SELECT
      COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS total_pending
    FROM fee_invoices fi
    WHERE fi.enrollment_id = :enrollmentId;
  `, { replacements: { enrollmentId } });

  return {
    total_pending: roundNumber(summary?.total_pending),
  };
}

exports.getStudentResults = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    // Get current enrollment for the student
    const [[student]] = await sequelize.query(`
      SELECT 
        s.id, e.id AS enrollment_id, e.session_id, e.class_id
      FROM students s
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      WHERE s.id = :id AND s.school_id = :schoolId
      ORDER BY e.joined_date DESC LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found or access denied.', [], 404);
    if (!student.enrollment_id) return res.ok({ exams: [] });

    const feeSummary = await getFeeSummaryForAdmin(student.enrollment_id);
    const [[sr]] = await sequelize.query(`
      SELECT release_result FROM student_results WHERE enrollment_id = :enrollmentId LIMIT 1;
    `, { replacements: { enrollmentId: student.enrollment_id } });
    
    const isWithheld = feeSummary.total_pending > 0 && !sr?.release_result;

    const [rows] = await sequelize.query(`
      SELECT
        ex.id, ex.name, ex.exam_type, ex.start_date, ex.end_date, ex.status,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM exam_results er
            WHERE er.exam_id = ex.id AND er.enrollment_id = :enrollmentId
          ) THEN 'published'
          WHEN ex.start_date > CURRENT_DATE THEN 'upcoming'
          ELSE 'awaiting'
        END AS student_status
      FROM exams ex
      WHERE ex.session_id = :sessionId AND ex.class_id = :classId
      ORDER BY ex.start_date DESC, ex.id DESC;
    `, {
      replacements: {
        enrollmentId: student.enrollment_id,
        sessionId: student.session_id,
        classId: student.class_id,
      },
    });

    res.ok({ exams: rows, is_withheld: isWithheld, total_pending: feeSummary.total_pending });
  } catch (err) { next(err); }
};

exports.getStudentResultByExam = async (req, res, next) => {
  try {
    const { id, examId } = req.params;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT 
        s.id, e.id AS enrollment_id, e.session_id, e.class_id
      FROM students s
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      WHERE s.id = :id AND s.school_id = :schoolId
      ORDER BY e.joined_date DESC LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!student || !student.enrollment_id) return res.fail('Student or active enrollment not found.', [], 404);

    const [[exam]] = await sequelize.query(`
      SELECT id, name, exam_type, start_date, end_date, status
      FROM exams
      WHERE id = :examId AND session_id = :sessionId AND class_id = :classId
      LIMIT 1;
    `, {
      replacements: {
        examId,
        sessionId: student.session_id,
        classId: student.class_id,
      },
    });

    if (!exam) return res.fail('Exam not found.', [], 404);

    const [rows] = await sequelize.query(`
      SELECT
        sub.id AS subject_id, sub.name AS subject_name, sub.code AS subject_code, sub.subject_type,
        es.combined_total_marks, es.combined_passing_marks,
        er.marks_obtained, er.theory_marks_obtained, er.practical_marks_obtained,
        er.is_absent, er.grade, er.is_pass
      FROM subjects sub
      JOIN exam_subjects es ON es.subject_id = sub.id AND es.exam_id = :examId
      LEFT JOIN exam_results er ON er.subject_id = sub.id AND er.exam_id = :examId AND er.enrollment_id = :enrollmentId
      WHERE sub.class_id = :classId AND sub.is_deleted = false
      ORDER BY sub.order_number ASC, sub.name ASC;
    `, {
      replacements: {
        examId,
        enrollmentId: student.enrollment_id,
        classId: student.class_id,
      },
    });

    const subjects = rows.map((row) => {
      const isPending = row.marks_obtained === null && row.theory_marks_obtained === null && row.practical_marks_obtained === null;
      const total_obtained = row.is_absent || isPending
        ? null
        : Number(row.marks_obtained ?? (Number(row.theory_marks_obtained || 0) + Number(row.practical_marks_obtained || 0)));
      const max_marks = Number(row.combined_total_marks || 0);
      return {
        ...row,
        total_obtained,
        percentage: total_obtained == null || max_marks === 0 ? null : roundNumber((total_obtained / max_marks) * 100),
        status: row.is_absent ? 'absent' : isPending ? 'pending' : row.is_pass ? 'pass' : 'fail',
      };
    });

    const totalObtained = subjects.filter((row) => row.total_obtained != null).reduce((sum, row) => sum + Number(row.total_obtained || 0), 0);
    const totalMax = subjects.reduce((sum, row) => sum + Number(row.combined_total_marks || 0), 0);
    const overall = totalMax > 0 ? roundNumber((totalObtained / totalMax) * 100) : 0;

    let overallGrade = 'F';
    if (overall >= 90) overallGrade = 'A+';
    else if (overall >= 80) overallGrade = 'A';
    else if (overall >= 70) overallGrade = 'B';
    else if (overall >= 60) overallGrade = 'C';
    else if (overall >= 50) overallGrade = 'D';

    const failedSubjects = subjects.filter((row) => row.status === 'fail').map((row) => row.subject_name);
    const result_status = failedSubjects.length === 0 ? 'pass' : failedSubjects.length <= 2 ? 'compartment' : 'fail';

    res.ok({
      exam,
      summary: { percentage: overall, grade: overallGrade, grade_color: gradeColor(overallGrade), result_status },
      subjects,
    });
  } catch (err) { next(err); }
};

exports.getStudentTimetable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT 
        s.id, e.id AS enrollment_id, e.session_id, e.class_id, e.section_id
      FROM students s
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      WHERE s.id = :id AND s.school_id = :schoolId
      ORDER BY e.joined_date DESC LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!student || !student.enrollment_id) return res.ok({ timetable: [] });

    const [rows] = await sequelize.query(`
      SELECT
        ts.id, ts.day_of_week, ts.period_number, ts.start_time, ts.end_time, ts.room_number,
        sub.name AS subject_name, sub.code AS subject_code,
        CONCAT(teacher.first_name, ' ', teacher.last_name) AS teacher_name
      FROM timetable_slots ts
      JOIN subjects sub ON sub.id = ts.subject_id
      JOIN teachers teacher ON teacher.id = ts.teacher_id
      WHERE ts.session_id = :sessionId
        AND ts.class_id = :classId
        AND ts.section_id = :sectionId
        AND ts.is_active = true
      ORDER BY
        ARRAY_POSITION(ARRAY['monday','tuesday','wednesday','thursday','friday','saturday'], ts.day_of_week::text),
        ts.period_number ASC;
    `, {
      replacements: {
        sessionId: student.session_id,
        classId: student.class_id,
        sectionId: student.section_id,
      },
    });

    res.ok({ timetable: rows });
  } catch (err) { next(err); }
};

exports.getStudentSummary = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    // 1. Basic Student & Enrollment Info
    const [[student]] = await sequelize.query(`
      SELECT 
        s.id, e.id AS enrollment_id, e.session_id, e.class_id, e.section_id
      FROM students s
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      WHERE s.id = :id AND s.school_id = :schoolId
      ORDER BY e.joined_date DESC LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    const enrollmentId = student.enrollment_id;

    // 2. Attendance Stats
    let attendance = { percentage: 0, status: 'N/A' };
    if (enrollmentId) {
      const stats = await getAttendancePercent(enrollmentId);
      attendance = { percentage: stats.percentage, status: stats.grade };
    }

    // 3. Fee Pending
    let fees = { total_pending: 0 };
    if (enrollmentId) {
      fees = await getFeeSummaryForAdmin(enrollmentId);
    }

    // 4. Latest Exam Result
    let latestResult = { percentage: 0, status: 'N/A' };
    if (enrollmentId) {
      const [[resRow]] = await sequelize.query(`
        SELECT percentage, result, grade
        FROM student_results
        WHERE enrollment_id = :enrollmentId
        ORDER BY created_at DESC LIMIT 1;
      `, { replacements: { enrollmentId } });
      if (resRow) {
        latestResult = { percentage: resRow.percentage, status: resRow.result || resRow.grade };
      }
    }

    // 5. Recent Remark
    const [[remark]] = await sequelize.query(`
      SELECT r.remark_text, CONCAT(t.first_name, ' ', t.last_name) AS teacher_name
      FROM student_remarks r
      JOIN teachers t ON t.id = r.teacher_id
      WHERE r.student_id = :id AND r.is_deleted = false
      ORDER BY r.created_at DESC LIMIT 1;
    `, { replacements: { id } });

    // 6. Next Event (from academic calendar)
    const [[nextEvent]] = await sequelize.query(`
      SELECT title, start_date, start_time
      FROM academic_events
      WHERE school_id = :schoolId 
        AND is_published = true 
        AND start_date >= CURRENT_DATE
        AND (audience = 'everyone' OR (audience = 'class' AND target_class_id = :classId))
      ORDER BY start_date ASC, start_time ASC LIMIT 1;
    `, { replacements: { schoolId, classId: student.class_id } });

    res.ok({
      attendance,
      fees,
      academic: latestResult,
      remark: remark || null,
      next_event: nextEvent || null
    });
  } catch (err) { next(err); }
};
