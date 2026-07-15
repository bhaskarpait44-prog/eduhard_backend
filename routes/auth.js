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
const redis = require('../config/redis');

const { generateResetPasswordHtml } = require('../utils/emailTemplates');

const RESET_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour
const MAX_FAILED_ATTEMPTS = 20;
// Fix #3: evaluate once at module load \u2014 not per-request
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

const { authenticate } = require('../middlewares/auth');

// Bug 6 Fix: Use process.env.JWT_SECRET directly. Startup check in server.js ensures it exists.
const JWT_SECRET = process.env.JWT_SECRET;

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

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}&email=${email}`;
      const appName = process.env.APP_NAME || 'EduHard';

      const html = generateResetPasswordHtml({
        name: user.name,
        resetUrl,
        appName,
      });

      await sendEmail({
        to: user.email,
        subject: `Reset Your Password | ${appName}`,
        text: `Hello ${user.name},\n\nYou requested a password reset. Please click the link below to reset your password:\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.\n`,
        html,
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
              parent_reset_password_expires = NULL
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

        // Sync if teacher
        if (user.type === 'teacher') {
          // Sync with users table by email
          await sequelize.query(`
            UPDATE users
            SET password_hash = :hash,
                reset_password_token = NULL,
                reset_password_expires = NULL,
                failed_login_attempts = 0,
                locked_until = NULL,
                force_password_change = false,
                updated_at = NOW()
            WHERE LOWER(email) = :email AND is_deleted = false;
          `, { replacements: { hash, email } });
        } else if (user.type === 'user') {
          // Check if this user has role = 'teacher'
          const [[userRow]] = await sequelize.query(`SELECT role::text FROM users WHERE id = :id`, { replacements: { id: user.id } });
          if (userRow && userRow.role === 'teacher') {
            // Sync with teachers table by email
            await sequelize.query(`
              UPDATE teachers
              SET password_hash = :hash,
                  reset_password_token = NULL,
                  reset_password_expires = NULL,
                  failed_login_attempts = 0,
                  locked_until = NULL,
                  force_password_change = false,
                  updated_at = NOW()
              WHERE LOWER(email) = :email AND is_deleted = false;
            `, { replacements: { hash, email } });
          }
        }
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

      if (!student) return res.fail('Incorrect admission number or email.', [], 401);
      if (!student.is_active) return res.fail('Account is deactivated.', [], 401);
      if (!student.password_hash) return res.fail('Portal access not configured. Please contact school admin.', [], 401);

      // Check if account is locked
      if (student.locked_until && new Date(student.locked_until) > new Date()) {
        const remainingMinutes = Math.ceil((new Date(student.locked_until) - new Date()) / 60000);
        return res.fail(`Account is temporarily locked. Please try again in ${remainingMinutes} minutes.`, [], 401);
      }

      const valid = await bcrypt.compare(password, student.password_hash);

      if (!valid) {
        // Atomic increment and fetch the new count
        const [[result]] = await sequelize.query(`
          UPDATE students
          SET failed_login_attempts = failed_login_attempts + 1
          WHERE id = :id
          RETURNING failed_login_attempts;
        `, { replacements: { id: student.id } });

        const newCount = result.failed_login_attempts;
        let lockedUntil = null;

        if (newCount >= MAX_FAILED_ATTEMPTS) {
          lockedUntil = new Date(Date.now() + LOCKOUT_DURATION);
          await sequelize.query(`
            UPDATE students
            SET locked_until = :lockedUntil
            WHERE id = :id;
          `, { replacements: { lockedUntil, id: student.id } });
        }

        if (lockedUntil) {
          return res.fail(`Account locked due to too many failed attempts. Try again in 15 minutes.`, [], 401);
        }
        return res.fail('Incorrect password.', [], 401);
      }

      // Reset failed attempts on success
      await sequelize.query(`
        UPDATE students
        SET last_login_at = NOW(),
            failed_login_attempts = 0,
            locked_until = NULL
        WHERE id = :id;
      `, { replacements: { id: student.id } });

      const payload = { 
        userId: student.id, 
        studentId: student.id,
        schoolId: student.school_id, 
        role: 'student',
        name: student.name,
        email: student.email 
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
      const refresh_token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

      res.ok({
        token,
        refresh_token,
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

      if (!user) return res.fail('Invalid email or password.', [], 401);
      if (!user.is_active) return res.fail('Account is deactivated.', [], 401);

      // Check if account is locked
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const remainingMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
        return res.fail(`Account is temporarily locked. Please try again in ${remainingMinutes} minutes.`, [], 401);
      }

      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        let newCount = 0;
        // Strict allowlist for table names to prevent SQL injection
        const allowedTables = ['user', 'teacher', 'student_profile'];
        if (!allowedTables.includes(user.table_name)) {
          console.error(`[SECURITY] Invalid table_name detected in login: ${user.table_name}`);
          return res.fail('Invalid email or password.', [], 401);
        }

        if (user.table_name === 'student_profile') {
          const [[result]] = await sequelize.query(`
            UPDATE student_profiles
            SET parent_failed_login_attempts = parent_failed_login_attempts + 1
            WHERE id = :id
            RETURNING parent_failed_login_attempts as failed_login_attempts;
          `, { replacements: { id: user.id } });
          newCount = result.failed_login_attempts;
        } else {
          const tableName = `${user.table_name}s`; // users or teachers
          const [[result]] = await sequelize.query(`
            UPDATE ${tableName}
            SET failed_login_attempts = failed_login_attempts + 1
            WHERE id = :id
            RETURNING failed_login_attempts;
          `, { replacements: { id: user.id } });
          newCount = result.failed_login_attempts;
        }

        let lockedUntil = null;
        if (newCount >= MAX_FAILED_ATTEMPTS) {
          lockedUntil = new Date(Date.now() + LOCKOUT_DURATION);
          if (user.table_name === 'student_profile') {
            await sequelize.query(`
              UPDATE student_profiles SET parent_locked_until = :lockedUntil WHERE id = :id;
            `, { replacements: { lockedUntil, id: user.id } });
          } else {
            const tableName = `${user.table_name}s`;
            await sequelize.query(`
              UPDATE ${tableName} SET locked_until = :lockedUntil WHERE id = :id;
            `, { replacements: { lockedUntil, id: user.id } });
          }
        }

        if (lockedUntil) {
          return res.fail(`Account locked due to too many failed attempts. Try again in 15 minutes.`, [], 401);
        }
        return res.fail('Invalid email or password.', [], 401);
      }

      const normalizedRole = normalizeUserRole(user.role);
      
      let finalUserId = user.id;
      let finalUserName = user.name;
      if (normalizedRole === 'teacher') {
        const [[teacher]] = await sequelize.query(`
          SELECT id, first_name, last_name FROM teachers WHERE LOWER(email) = :email AND is_deleted = false LIMIT 1;
        `, { replacements: { email: user.email } });
        if (teacher) {
          finalUserId = teacher.id;
          finalUserName = `${teacher.first_name} ${teacher.last_name}`.trim();
        }
      }

      const permissions = Array.from(await loadUserPermissions(finalUserId, normalizedRole));

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

      const payload = { 
        userId: finalUserId, 
        schoolId: user.school_id, 
        role: normalizedRole,
        name: finalUserName,
        email: user.email 
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
      const refresh_token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

      res.ok({
        token,
        refresh_token,
        user: {
          id: finalUserId,
          name: finalUserName,
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

router.post('/change-password',
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const { id, role } = req.user;

      let table = 'users';
      if (role === 'teacher') table = 'teachers';
      else if (role === 'student') table = 'students';

      const query = role === 'parent' 
        ? `SELECT parent_password_hash as password_hash FROM student_profiles WHERE id = :id LIMIT 1`
        : `SELECT password_hash FROM ${table} WHERE id = :id LIMIT 1`;

      const [[user]] = await sequelize.query(query, { replacements: { id } });

      if (!user || !user.password_hash) return res.fail('User not found or password not set.', [], 404);

      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.fail('Incorrect current password.', [], 400);

      const hash = await bcrypt.hash(newPassword, 12);

      if (role === 'parent') {
        await sequelize.query(`UPDATE student_profiles SET parent_password_hash = :hash WHERE id = :id`, { replacements: { hash, id } });
      } else {
        await sequelize.query(`UPDATE ${table} SET password_hash = :hash, force_password_change = false, updated_at = NOW() WHERE id = :id`, { replacements: { hash, id } });

        // Sync if teacher
        if (role === 'teacher') {
          const userEmail = req.user.email;
          if (userEmail) {
            if (table === 'teachers') {
              await sequelize.query(`UPDATE users SET password_hash = :hash, updated_at = NOW() WHERE LOWER(email) = :email AND is_deleted = false`, { replacements: { hash, email: userEmail.toLowerCase() } });
            } else if (table === 'users') {
              await sequelize.query(`UPDATE teachers SET password_hash = :hash, force_password_change = false, last_password_change = NOW(), updated_at = NOW() WHERE LOWER(email) = :email AND is_deleted = false`, { replacements: { hash, email: userEmail.toLowerCase() } });
            }
          }
        }
      }

      res.ok({}, 'Password changed successfully.');
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

// Bug 5 Fix: Check if refresh token is blacklisted
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.fail('Invalid refresh token.', [], 401);

    // Bug 7: Hash the token before checking blacklist
    const tokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');

    // Fix #3 (refresh): use module-level REDIS_ENABLED constant (see top of file)
    if (REDIS_ENABLED) {
      if (redis.status === 'ready') {
        const isBlacklisted = await redis.get(`blacklist:${tokenHash}`);
        if (isBlacklisted) {
          return res.fail('Token has been revoked. Please log in again.', [], 401);
        }
      } else {
        // Fix #2 (refresh): fail-open \u2014 a Redis blip must not lock out all users from refreshing tokens.
        console.warn(`[SECURITY] Redis is enabled but status is "${redis.status}". Blacklist check skipped on refresh \u2014 allowing through.`);
      }
    }

    const decoded = jwt.verify(refresh_token, JWT_SECRET);

    // Security: Blacklist the old refresh token after rotation
    if (REDIS_ENABLED && redis.status === 'ready' && decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        // Reuse tokenHash computed above
        await redis.setex(`blacklist:${tokenHash}`, ttl, '1');
      }
    }

    const payload = {
      userId: decoded.userId,
      schoolId: decoded.schoolId,
      role: decoded.role,
      name: decoded.name,
      email: decoded.email,
      studentId: decoded.studentId
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    const newRefreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    return res.ok({ token, refresh_token: newRefreshToken }, 'Token refreshed successfully.');
  } catch (err) {
    return res.fail('Invalid refresh token.', [], 401);
  }
});

/**
 * Logout - Blacklist both access and refresh tokens
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refresh_token } = req.body;
    const header = req.headers.authorization;
    const accessToken = header.split(' ')[1];
    
    // Bug 4 Fix: Blacklist both tokens if they exist and have exp
    const blacklistToken = async (token) => {
      if (!token) return;
      try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0 && redis.status === 'ready') {
            // Bug 7: Store SHA-256 hash instead of full token
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            await redis.setex(`blacklist:${tokenHash}`, ttl, '1');
          }
        }
      } catch (e) {
        console.error('[Logout] Failed to blacklist token:', e.message);
      }
    };

    await blacklistToken(accessToken);
    if (refresh_token) await blacklistToken(refresh_token);

    // Fix #7: delete the online heartbeat key so the user shows as offline immediately.
    // Without this, the UI would continue showing them as online for up to 5 minutes.
    if (req.user && redis.status === 'ready') {
      const { id, role, school_id } = req.user;
      const onlineKey = `online:${school_id}:${role}:${id}`;
      redis.del(onlineKey).catch(() => {});
    }

    res.ok({}, 'Logged out successfully.');
  } catch (err) {
    res.fail('Logout failed.', [err.message]);
  }
});

module.exports = router;
