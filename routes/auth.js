'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body } = require('express-validator');
const validate = require('../middlewares/validate');
const sequelize = require('../config/database');
const { authLimiter } = require('../middlewares/rateLimiter');
const { loadUserPermissions } = require('../middlewares/checkPermission');
const { normalizeUserRole } = require('../utils/roles');
const { sendEmail } = require('../utils/mailer');
const studentLoginValidation = require('../middlewares/studentLoginValidator');

const RESET_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour
const MAX_FAILED_ATTEMPTS = 20;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes

const { authenticate } = require('../middlewares/auth');

router.post('/forgot-password',
  authLimiter,
  [body('email').isEmail()],
  validate,
  async (req, res, next) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      
      // Check users, students, teachers, and parents
      const [[user]] = await sequelize.query(`
        SELECT id, 'user' as type, name, email FROM users WHERE LOWER(email) = :email AND is_deleted = false
        UNION
        SELECT s.id, 'student' as type, CONCAT(s.first_name, ' ', s.last_name) as name, sp.email 
        FROM students s
        JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
        WHERE LOWER(sp.email) = :email AND s.is_deleted = false
        UNION
        SELECT id, 'teacher' as type, CONCAT(first_name, ' ', last_name) as name, email FROM teachers WHERE LOWER(email) = :email AND is_deleted = false
        UNION
        SELECT sp.id, 'parent' as type, COALESCE(sp.father_name, sp.mother_name, 'Parent') as name, sp.parent_email as email
        FROM student_profiles sp
        JOIN students s ON s.id = sp.student_id
        WHERE LOWER(sp.parent_email) = :email AND sp.is_current = true AND s.is_deleted = false
        LIMIT 1;
      `, { replacements: { email } });

      // Security best practice: don't reveal if email exists
      if (!user) return res.ok({}, 'If an account with that email exists, a password reset link has been sent.');

      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + RESET_TOKEN_EXPIRY);

      if (user.type === 'parent') {
        await sequelize.query(`
          UPDATE student_profiles
          SET parent_reset_password_token = :token,
              parent_reset_password_expires = :expires
          WHERE id = :id;
        `, { replacements: { token, expires, id: user.id } });
      } else {
        const table = user.type === 'user' ? 'users' : (user.type === 'student' ? 'students' : 'teachers');
        await sequelize.query(`
          UPDATE ${table}
          SET reset_password_token = :token,
              reset_password_expires = :expires
          WHERE id = :id;
        `, { replacements: { token, expires, id: user.id } });
      }

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}&email=${email}`;

      await sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        text: `Hello ${user.name},\n\nYou requested a password reset. Please click the link below to reset your password:\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.\n`,
        html: `<p>Hello ${user.name},</p><p>You requested a password reset. Please click the link below to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, please ignore this email.</p>`,
      });

      return res.ok({}, 'If an account with that email exists, a password reset link has been sent.');
    } catch (err) { next(err); }
  }
);

router.post('/reset-password',
  authLimiter,
  [
    body('token').notEmpty(),
    body('email').isEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { token, password } = req.body;
      const email = String(req.body.email || '').trim().toLowerCase();

      // Check users, students, teachers, and parents
      const [[user]] = await sequelize.query(`
        SELECT id, 'user' as type FROM users 
        WHERE LOWER(email) = :email AND reset_password_token = :token AND reset_password_expires > NOW() AND is_deleted = false
        UNION
        SELECT s.id, 'student' as type
        FROM students s
        JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
        WHERE LOWER(sp.email) = :email AND s.reset_password_token = :token AND s.reset_password_expires > NOW() AND s.is_deleted = false
        UNION
        SELECT id, 'teacher' as type FROM teachers
        WHERE LOWER(email) = :email AND reset_password_token = :token AND reset_password_expires > NOW() AND is_deleted = false
        UNION
        SELECT sp.id, 'parent' as type
        FROM student_profiles sp
        JOIN students s ON s.id = sp.student_id
        WHERE LOWER(sp.parent_email) = :email AND sp.parent_reset_password_token = :token AND sp.parent_reset_password_expires > NOW() AND s.is_deleted = false
        LIMIT 1;
      `, { replacements: { email, token } });

      if (!user) return res.fail('Invalid or expired reset token.', [], 400);

      const hash = await bcrypt.hash(password, 12);

      if (user.type === 'parent') {
        await sequelize.query(`
          UPDATE student_profiles
          SET parent_password_hash = :hash,
              parent_reset_password_token = NULL,
              parent_reset_password_expires = NULL,
              parent_last_login_at = NULL
          WHERE id = :id;
        `, { replacements: { hash, id: user.id } });
      } else {
        const table = user.type === 'user' ? 'users' : (user.type === 'student' ? 'students' : 'teachers');

        await sequelize.query(`
          UPDATE ${table}
          SET password_hash = :hash,
              reset_password_token = NULL,
              reset_password_expires = NULL,
              failed_login_attempts = 0,
              locked_until = NULL,
              force_password_change = false,
              updated_at = NOW()
          WHERE id = :id;
        `, { replacements: { hash, id: user.id } });
      }

      return res.ok({}, 'Password has been reset successfully. You can now log in with your new password.');
    } catch (err) { next(err); }
  }
);

router.post('/student/login',
  authLimiter,
  studentLoginValidation,
  validate,
  async (req, res, next) => {
    try {
      const { password, identifier, admission_no, email: reqEmail } = req.body;
      
      const searchEmail = (reqEmail || identifier || '').trim().toLowerCase();
      const searchAdmission = (admission_no || identifier || '').trim();

      const [[student]] = await sequelize.query(`
        SELECT s.id, s.school_id, CONCAT(s.first_name, ' ', s.last_name) as name, 
               s.password_hash, s.is_active, s.is_deleted, s.failed_login_attempts, s.locked_until,
               sp.email, s.admission_no
        FROM students s
        LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
        WHERE s.is_deleted = false
          AND (
            LOWER(s.admission_no) = LOWER(:admission_no)
            OR (sp.email IS NOT NULL AND LOWER(sp.email) = :email)
          )
        LIMIT 1;
      `, { replacements: { admission_no: searchAdmission, email: searchEmail } });

      if (!student) return res.fail('Invalid credentials.', [], 401);
      if (!student.is_active) return res.fail('Account is deactivated.', [], 401);
      if (!student.password_hash) return res.fail('Portal access not configured. Please contact school admin.', [], 401);

      // Check if account is locked
      if (student.locked_until && new Date(student.locked_until) > new Date()) {
        const remainingMinutes = Math.ceil((new Date(student.locked_until) - new Date()) / 60000);
        return res.fail(`Account is temporarily locked. Please try again in ${remainingMinutes} minutes.`, [], 401);
      }

      const valid = await bcrypt.compare(password, student.password_hash);

      if (!valid) {
        // Increment failed attempts
        const failedAttempts = (student.failed_login_attempts || 0) + 1;
        let lockedUntil = null;

        if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
          lockedUntil = new Date(Date.now() + LOCKOUT_DURATION);
        }

        await sequelize.query(`
          UPDATE students
          SET failed_login_attempts = :failedAttempts,
              locked_until = :lockedUntil
          WHERE id = :id;
        `, { replacements: { failedAttempts, lockedUntil, id: student.id } });

        if (lockedUntil) {
          return res.fail(`Account locked due to too many failed attempts. Try again in 15 minutes.`, [], 401);
        }
        return res.fail('Invalid credentials.', [], 401);
      }

      // Reset failed attempts on success
      await sequelize.query(`
        UPDATE students
        SET last_login_at = NOW(),
            failed_login_attempts = 0,
            locked_until = NULL
        WHERE id = :id;
      `, { replacements: { id: student.id } });

      const token = jwt.sign(
        { 
          userId: student.id, 
          studentId: student.id,
          schoolId: student.school_id, 
          role: 'student',
          name: student.name,
          email: student.email 
        },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '24h' }
      );

      res.ok({
        token,
        user: {
          id: student.id,
          name: student.name,
          email: student.email,
          role: 'student',
          school_id: student.school_id,
          admission_no: student.admission_no,
        },
        permissions: [],
      }, 'Login successful.');
    } catch (err) { next(err); }
  }
);

router.post('/login',
  authLimiter,
  [body('email').isEmail(), body('password').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { password } = req.body;
      const email = String(req.body.email || '').trim().toLowerCase();
      
      const [[user]] = await sequelize.query(`
        SELECT id, school_id, name, email, password_hash, role::text, is_active, force_password_change, 
               failed_login_attempts, locked_until, 'user' as table_name
        FROM users
        WHERE LOWER(email) = :email AND is_deleted = false
        UNION
        SELECT id, school_id, CONCAT(first_name, ' ', last_name) as name, email, password_hash, 'teacher' as role, is_active, force_password_change, 
               failed_login_attempts, locked_until, 'teacher' as table_name
        FROM teachers
        WHERE LOWER(email) = :email AND is_deleted = false
        UNION
        SELECT sp.id, s.school_id, COALESCE(sp.father_name, sp.mother_name, 'Parent') as name, sp.parent_email as email, sp.parent_password_hash as password_hash, 'parent' as role, s.is_active, false as force_password_change, 
               sp.parent_failed_login_attempts as failed_login_attempts, sp.parent_locked_until as locked_until, 'student_profile' as table_name
        FROM student_profiles sp
        JOIN students s ON s.id = sp.student_id
        WHERE LOWER(sp.parent_email) = :email AND sp.is_current = true AND s.is_deleted = false
        LIMIT 1;
      `, { replacements: { email } });

      if (!user) return res.fail('Invalid credentials.', [], 401);
      if (!user.is_active) return res.fail('Account is deactivated.', [], 401);

      // Check if account is locked
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const remainingMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
        return res.fail(`Account is temporarily locked. Please try again in ${remainingMinutes} minutes.`, [], 401);
      }

      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        // Increment failed attempts
        const failedAttempts = (user.failed_login_attempts || 0) + 1;
        let lockedUntil = null;

        if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
          lockedUntil = new Date(Date.now() + LOCKOUT_DURATION);
        }

        if (user.table_name === 'student_profile') {
          await sequelize.query(`
            UPDATE student_profiles
            SET parent_failed_login_attempts = :failedAttempts,
                parent_locked_until = :lockedUntil
            WHERE id = :id;
          `, { replacements: { failedAttempts, lockedUntil, id: user.id } });
        } else {
          await sequelize.query(`
            UPDATE ${user.table_name}s
            SET failed_login_attempts = :failedAttempts,
                locked_until = :lockedUntil
            WHERE id = :id;
          `, { replacements: { failedAttempts, lockedUntil, id: user.id } });
        }

        if (lockedUntil) {
          return res.fail(`Account locked due to too many failed attempts. Try again in 15 minutes.`, [], 401);
        }
        return res.fail('Invalid credentials.', [], 401);
      }

      const normalizedRole = normalizeUserRole(user.role);
      const permissions = Array.from(await loadUserPermissions(user.id, normalizedRole));

      // Reset failed attempts on success
      if (user.table_name === 'student_profile') {
        await sequelize.query(`
          UPDATE student_profiles
          SET parent_last_login_at = NOW(),
              parent_failed_login_attempts = 0,
              parent_locked_until = NULL
          WHERE id = :id;
        `, { replacements: { id: user.id } });
      } else {
        await sequelize.query(`
          UPDATE ${user.table_name}s
          SET last_login_at = NOW(),
              failed_login_attempts = 0,
              locked_until = NULL
          WHERE id = :id;
        `, { replacements: { id: user.id } });
      }

      const token = jwt.sign(
        { 
          userId: user.id, 
          schoolId: user.school_id, 
          role: normalizedRole,
          name: user.name,
          email: user.email 
        },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '24h' }
      );

      res.ok({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: normalizedRole,
          school_id: user.school_id,
          force_password_change: user.force_password_change,
        },
        permissions,
      }, 'Login successful.');
    } catch (err) { next(err); }
  }
);

router.get('/me', authenticate, async (req, res) => {
  // Middleware 'authenticate' already attached req.user
  if (!req.user) return res.fail('Not authenticated.', [], 401);
  
  const normalizedRole = normalizeUserRole(req.user.role);
  const permissions = Array.from(await loadUserPermissions(req.user.id, normalizedRole));

  res.ok({
    user: req.user,
    permissions,
  });
});

/**
 * Register push token for notifications
 */
router.post('/push-token',
  authenticate,
  [body('token').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { token, platform, device_name } = req.body;
      const userId = req.user?.id;
      const studentId = req.user?.student_id;
      const role = req.user?.role;

      // Determine which column to use based on role
      let column = 'user_id';
      let id = userId;
      if (role === 'student') {
        column = 'student_id';
        id = studentId;
      } else if (role === 'teacher') {
        column = 'teacher_id';
        id = userId; // In teacher-mobile, userId in token IS the teacher's ID
      }

      await sequelize.query(`
        INSERT INTO push_tokens (${column}, token, platform, device_name, last_used, created_at, updated_at)
        VALUES (:id, :token, :platform, :device_name, NOW(), NOW(), NOW())
        ON CONFLICT (token) DO UPDATE
        SET ${column} = EXCLUDED.${column},
            last_used = NOW(),
            updated_at = NOW();
      `, {
        replacements: { id, token, platform: platform || null, device_name: device_name || null },
      });

      res.ok({}, 'Push token registered.');
    } catch (err) { next(err); }
  }
);

router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.fail('Invalid refresh token.', [], 401);

    const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET || 'secret');
    const payload = {
      userId: decoded.userId,
      schoolId: decoded.schoolId,
      role: decoded.role,
      name: decoded.name,
      email: decoded.email,
      studentId: decoded.studentId
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });

    return res.ok({ token, refresh_token }, 'Token refreshed successfully.');
  } catch (err) {
    return res.fail('Invalid refresh token.', [], 401);
  }
});

/**
 * Logout - Blacklist the current token
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const header = req.headers.authorization;
    const token = header.split(' ')[1];
    const decoded = jwt.decode(token);

    if (decoded && decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        const redis = require('../config/redis');
        await redis.setex(`blacklist:${token}`, ttl, 'true');
      }
    }

    res.ok({}, 'Logged out successfully.');
  } catch (err) {
    res.fail('Logout failed.', [err.message]);
  }
});

module.exports = router;
