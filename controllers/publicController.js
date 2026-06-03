'use strict';

const sequelize = require('../config/database');

// ── GET /api/public/sessions/current ────────────────────────────────────────
exports.getCurrentSession = async (req, res, next) => {
  try {
    const schoolId = req.query.school_id || 1;

    const [[data]] = await sequelize.query(`
      SELECT 
        s.id, s.name, s.start_date, s.end_date,
        sch.online_admission_open
      FROM sessions s
      JOIN schools sch ON sch.id = s.school_id
      WHERE s.school_id = :schoolId AND s.is_current = true
      LIMIT 1;
    `, { replacements: { schoolId } });

    if (!data) return res.ok(null, 'No active session found.');
    res.ok(data, 'Current session retrieved.');
  } catch (err) { next(err); }
};

// ── GET /api/public/classes ──────────────────────────────────────────────────
exports.getClasses = async (req, res, next) => {
  try {
    const schoolId = req.query.school_id || 1;

    const [classes] = await sequelize.query(`
      SELECT id, name, stream, order_number
      FROM classes
      WHERE school_id = :schoolId AND is_active = true AND is_deleted = false
      ORDER BY order_number ASC;
    `, { replacements: { schoolId } });

    res.ok(classes, `${classes.length} classes found.`);
  } catch (err) { next(err); }
};

// ── POST /api/applications ───────────────────────────────────────────────────
exports.createApplication = async (req, res, next) => {
  try {
    // When using multer (multipart/form-data), fields might be strings
    const body = req.body;
    
    // Parse JSON fields if they are sent as strings
    let student_data = body;
    if (typeof body.student_data === 'string') {
      try {
        student_data = JSON.parse(body.student_data);
      } catch (e) {
        return res.fail('Invalid student_data format.', [], 422);
      }
    }

    const { 
      first_name, last_name, email, class_id, 
      ...rest 
    } = student_data;
    
    // Validate required fields
    if (!first_name || !last_name || !email || !class_id) {
      return res.fail('Missing required fields.', [], 422);
    }

    const schoolId = body.school_id || 1;

    // Check if admissions are open
    const [[school]] = await sequelize.query(`
      SELECT online_admission_open FROM schools WHERE id = :schoolId;
    `, { replacements: { schoolId } });

    if (!school || !school.online_admission_open) {
      return res.fail('Online admissions are currently closed.', [], 403);
    }

    // Get current session for this school
    const [[session]] = await sequelize.query(`
      SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
    `, { replacements: { schoolId } });

    if (!session) return res.fail('Applications are currently closed (no active session).', [], 400);

    // Handle files
    const documents = {};
    if (req.files) {
      if (req.files.photo) documents.photo = req.files.photo[0].path;
      if (req.files.birth_certificate) documents.birth_certificate = req.files.birth_certificate[0].path;
      if (req.files.marksheet) documents.marksheet = req.files.marksheet[0].path;
    }

    const reference_no = `APP-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const [[application]] = await sequelize.query(`
      INSERT INTO applications 
        (school_id, reference_no, session_id, class_id, student_data, status, created_at, updated_at)
      VALUES 
        (:schoolId, :ref, :sessionId, :classId, :data, 'pending', NOW(), NOW())
      RETURNING id, reference_no;
    `, {
      replacements: {
        schoolId,
        ref: reference_no,
        sessionId: session.id,
        classId: class_id,
        data: JSON.stringify({ 
          first_name, last_name, email, ...rest, 
          documents // Store file paths
        })
      }
    });

    res.ok(application, 'Application submitted successfully.', 201);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError' || (err.parent && err.parent.code === '23505')) {
       // Retry once if reference_no collided (unlikely)
       return exports.createApplication(req, res, next);
    }
    next(err);
  }
};

// ── GET /api/public/applications/status ──────────────────────────────────────
exports.getApplicationStatus = async (req, res, next) => {
  try {
    const { reference_no, email } = req.query;

    if (!reference_no || !email) {
      return res.fail('Reference number and email are required.', [], 422);
    }

    const [[application]] = await sequelize.query(`
      SELECT 
        a.id, a.reference_no, a.status, a.student_data, a.created_at,
        c.name AS class_name, sess.name AS session_name
      FROM applications a
      LEFT JOIN classes c ON c.id = a.class_id
      LEFT JOIN sessions sess ON sess.id = a.session_id
      WHERE a.reference_no = :reference_no 
        AND (a.student_data->>'email') = :email;
    `, { replacements: { reference_no, email } });

    if (!application) {
      return res.fail('No application found with these details.', [], 404);
    }

    res.ok({
      reference_no: application.reference_no,
      status: application.status,
      student_name: `${application.student_data.first_name} ${application.student_data.last_name}`,
      class_name: application.class_name,
      session_name: application.session_name,
      applied_at: application.created_at
    });
  } catch (err) { next(err); }
};
