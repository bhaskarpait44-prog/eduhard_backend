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
    const { 
      first_name, last_name, email, class_id, 
      ...rest 
    } = req.body;
    
    // Validate required fields
    if (!first_name || !last_name || !email || !class_id) {
      return res.fail('Missing required fields.', [], 422);
    }

    const schoolId = req.body.school_id || 1;

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
        data: JSON.stringify({ first_name, last_name, email, ...rest })
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
