'use strict';

const sequelize        = require('../config/database');
const redis            = require('../config/redis');
const bcrypt           = require('bcryptjs');
const auditLogger      = require('../utils/auditLogger');
const profileVersioning = require('../utils/profileVersioning');
const { generateStudentPassword } = require('../utils/studentCredentials');
const { invalidateCache } = require('../middlewares/cache');

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
    const { 
      admission_no, first_name, last_name, date_of_birth, gender, 
      profile, password, parent_password 
    } = req.body;
    const schoolId = req.user.school_id;
    const studentEmail = profile?.email?.trim().toLowerCase();

    // Parent details from profile
    const parentEmail = (profile?.father_email || profile?.mother_email || profile?.email)?.trim().toLowerCase();
    const parentName = profile?.father_name || profile?.mother_name || `${last_name} Family`;
    const parentPhone = profile?.father_phone || profile?.mother_phone || profile?.phone;

    if (!studentEmail) {
      return res.fail('Student email is required at admission.', [], 422);
    }
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

      // 2. Handle Parent User Account
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
          date_of_birth, gender, password_hash, is_active, 
          last_password_change, is_deleted, created_at, updated_at
        )
        VALUES (
          :schoolId, :familyId, :admission_no, :first_name, :last_name, 
          :date_of_birth, :gender, :studentHash, true, 
          NOW(), false, NOW(), NOW()
        )
        RETURNING id, admission_no, first_name, last_name, date_of_birth, gender, status;
      `, {
        replacements: {
          schoolId, familyId, admission_no, first_name, last_name, 
          date_of_birth, gender, studentHash,
        },
        transaction: t,
      });

      return { student, parentAccountCreated, generatedParentPassword, parentEmail };
    });

    // Create initial profile version if profile data provided
    if (profile) {
      await profileVersioning.create({
        studentId    : result.student.id,
        data         : { ...profile, email: studentEmail },
        changedBy    : req.user.id,
        changeReason : 'Initial profile created on admission',
      });
    }

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
            const year = new Date(row.admission_date).getFullYear();
            const [[seq]] = await sequelize.query(
              `SELECT COUNT(*)::int + 1 as next_val FROM students WHERE school_id = :schoolId AND admission_no LIKE :pattern`,
              { 
                replacements: { schoolId, pattern: `ADM-${year}-%` },
                transaction: t,
                lock: t.LOCK.UPDATE 
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
              date_of_birth, gender, password_hash, is_active, 
              last_password_change, is_deleted, created_at, updated_at
            )
            VALUES (
              :schoolId, :admNo, :firstName, :lastName, 
              :dob, :gender, :hash, true, 
              NOW(), false, NOW(), NOW()
            )
            RETURNING id;
          `, {
            replacements: {
              schoolId, admNo, firstName: row.first_name.trim(), lastName: row.last_name.trim(),
              dob: row.date_of_birth, gender: row.gender.trim().toLowerCase(), hash,
            },
            transaction: t,
          });

          // 4. Create Profile (v1)
          await profileVersioning.create({
            studentId: student.id,
            data: {
              father_name: row.father_name || null,
              mother_name: row.mother_name || null,
              phone: row.guardian_phone || null,
              address: row.address || null,
              blood_group: row.blood_group || null,
              religion: row.religion || null,
              caste: row.caste || null,
              previous_school: row.previous_school || null,
            },
            changedBy: req.user.id,
            changeReason: 'Bulk admission import',
          }, { transaction: t });

          // 5. Create Enrollment
          const classId = classMap.get(row.admission_class.trim().toLowerCase());
          const sectionId = sectionMap.get(`${row.admission_class.trim().toLowerCase()}|${row.section.trim().toLowerCase()}`);

          if (session && classId && sectionId) {
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
              transaction: t,
              lock: t.LOCK.UPDATE
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
      SELECT s.id, s.admission_no, s.first_name, s.last_name, s.date_of_birth, s.gender,
             s.status, s.created_at, s.family_id, s.transport_stop_id,
             sp.address, sp.city, sp.state, sp.pincode, sp.phone, sp.email,
             sp.father_name, sp.father_phone, sp.mother_name, sp.mother_phone,
             sp.parent_email,
             sp.blood_group, sp.medical_notes, sp.photo_path,
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

    res.ok({ 
      ...student, 
      is_online, 
      current_enrollment: enrollment || null,
      siblings,
      library_issues: libraryIssues
    }, 'Student retrieved.');
  } catch (err) { next(err); }
};

// ── PATCH /api/students/:id/identity ─────────────────────────────────────────
exports.updateIdentity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { admission_no, first_name, last_name, date_of_birth, gender, reason } = req.body;

    const [[student]] = await sequelize.query(`
      SELECT id, admission_no, first_name, last_name, date_of_birth, gender
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

    // Set audit context — trigger reads these for each field change
    await auditLogger.setContext(sequelize, {
      changedBy  : req.user.id,
      reason,
      ipAddress  : req.ip,
      deviceInfo : req.headers['user-agent'],
    });

    const updates = {};
    if (admission_no)  updates.admission_no  = admission_no;
    if (first_name)    updates.first_name    = first_name;
    if (last_name)     updates.last_name     = last_name;
    if (date_of_birth) updates.date_of_birth = date_of_birth;
    if (gender)        updates.gender        = gender;

    if (Object.keys(updates).length === 0) {
      return res.fail('No fields provided to update.');
    }

    const setClauses = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
    const [[updated]] = await sequelize.query(`
      UPDATE students SET ${setClauses}, updated_at = NOW()
      WHERE id = :id
      RETURNING id, admission_no, first_name, last_name, date_of_birth, gender, status;
    `, { replacements: { ...updates, id } });

    res.ok(updated, 'Student identity updated. Audit log written.');

    // Invalidate student list and detail cache
    invalidateCache(req.user.school_id, '/api/students*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

// ── PATCH /api/students/:id/profile ──────────────────────────────────────────
exports.updateProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { change_reason, ...newData } = req.body;

    const [[student]] = await sequelize.query(`
      SELECT id FROM students WHERE id = :id AND school_id = :schoolId AND is_deleted = false;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!student) return res.fail('Student not found.', [], 404);

    const result = await profileVersioning.update({
      studentId    : parseInt(id),
      newData,
      changedBy    : req.user.id,
      changeReason : change_reason,
      ipAddress    : req.ip,
      deviceInfo   : req.headers['user-agent'],
    });

    res.ok({
      new_version : result.newVersion,
      old_version : { id: result.oldVersion.id, valid_from: result.oldVersion.valid_from, valid_to: result.oldVersion.valid_to },
    }, 'Profile updated. New version created.');

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
      }, { transaction: t });

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
