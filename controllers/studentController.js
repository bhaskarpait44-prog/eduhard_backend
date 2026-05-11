'use strict';

const sequelize        = require('../config/database');
const bcrypt           = require('bcryptjs');
const auditLogger      = require('../utils/auditLogger');
const profileVersioning = require('../utils/profileVersioning');
const { generateStudentPassword } = require('../utils/studentCredentials');

// ── GET /api/students ────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const {
      search = '',
      class_id = '',
      section_id = '',
      session_id = '',
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

    const replacements = {
      schoolId,
      search: `%${search}%`,
      class_id: class_id || null,
      section_id: section_id || null,
      session_id: session_id || null,
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

    const formatted = students.map(student => ({
      id: student.id,
      admission_no: student.admission_no,
      first_name: student.first_name,
      last_name: student.last_name,
      date_of_birth: student.date_of_birth,
      gender: student.gender,
      status: student.status,
      is_active: student.is_active,
      is_deleted: student.is_deleted,
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
    const { admission_no, first_name, last_name, date_of_birth, gender, profile, password } = req.body;
    const schoolId = req.user.school_id;
    const studentEmail = profile?.email?.trim().toLowerCase();

    if (!studentEmail) {
      return res.fail('Student email is required at admission.', [], 422);
    }

    const generatedPassword = password || generateStudentPassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 12);

    const result = await sequelize.transaction(async (t) => {
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

      const [[student]] = await sequelize.query(`
        INSERT INTO students (
          school_id,
          admission_no,
          first_name,
          last_name,
          date_of_birth,
          gender,
          password_hash,
          is_active,
          last_password_change,
          is_deleted,
          created_at,
          updated_at
        )
        VALUES (
          :schoolId,
          :admission_no,
          :first_name,
          :last_name,
          :date_of_birth,
          :gender,
          :passwordHash,
          true,
          NOW(),
          false,
          NOW(),
          NOW()
        )
        RETURNING id, admission_no, first_name, last_name, date_of_birth, gender, status;
      `, {
        replacements: {
          schoolId,
          admission_no,
          first_name,
          last_name,
          date_of_birth,
          gender,
          passwordHash,
        },
        transaction: t,
      });

      return student;
    });

    // Create initial profile version if profile data provided
    if (profile) {
      await profileVersioning.create({
        studentId    : result.id,
        data         : { ...profile, email: studentEmail },
        changedBy    : req.user.id,
        changeReason : 'Initial profile created on admission',
      });
    }

    res.ok({
      ...result,
      login_credentials: {
        email: studentEmail,
        admission_no,
        password: generatedPassword,
        password_auto_generated: true,
      },
    }, 'Student admitted successfully.', 201);
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
        sp.father_name, sp.mother_name,
        e.roll_number, e.joined_date, e.left_date, e.joining_type, e.leaving_type, e.status AS enrollment_status,
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

    res.ok(data);
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
             s.status, s.created_at,
             sp.address, sp.city, sp.state, sp.pincode, sp.phone, sp.email,
             sp.father_name, sp.father_phone, sp.mother_name, sp.mother_phone,
             sp.blood_group, sp.medical_notes, sp.photo_path
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      WHERE s.id = :id AND s.school_id = :schoolId AND s.is_deleted = false;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!student) return res.fail('Student not found.', [], 404);

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

    res.ok({ ...student, current_enrollment: enrollment || null }, 'Student retrieved.');
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

