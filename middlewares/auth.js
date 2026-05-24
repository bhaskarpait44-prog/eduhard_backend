'use strict';

/**
 * middlewares/auth.js
 * JWT verification + role-based access control.
 * Attaches req.user to every authenticated request.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sequelize = require('../config/database');
const { normalizeUserRole } = require('../utils/roles');
const redis = require('../config/redis');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Helper to update user's online status in Redis
 * Uses a 5-minute TTL as a heartbeat
 */
const trackOnlineStatus = (user) => {
  if (redis.status === 'ready' && user) {
    const { id, role, school_id } = user;
    const key = `online:${school_id}:${role}:${id}`;
    redis.set(key, '1', 'EX', 300).catch(() => {});
  }
};

async function resolveStudentFromToken(decoded) {
  if (decoded.studentId) {
    const [[student]] = await sequelize.query(`
      SELECT id, school_id, admission_no, first_name, last_name, is_active, is_deleted
      FROM students
      WHERE id = :id
      LIMIT 1;
    `, { replacements: { id: decoded.studentId } });
    return student || null;
  }

  if (!decoded.userId) return null;

  const [[student]] = await sequelize.query(`
    SELECT
      s.id,
      s.school_id,
      s.admission_no,
      s.first_name,
      s.last_name,
      s.is_active,
      s.is_deleted
    FROM users u
    JOIN students s
      ON s.school_id = u.school_id
     AND s.is_deleted = false
    LEFT JOIN student_profiles sp
      ON sp.student_id = s.id
     AND sp.is_current = true
    WHERE u.id = :userId
      AND u.role = 'student'
      AND u.is_deleted = false
      AND (
        (u.employee_id IS NOT NULL AND s.admission_no = u.employee_id)
        OR LOWER(COALESCE(sp.email, '')) = LOWER(COALESCE(u.email, ''))
      )
    ORDER BY s.id DESC
    LIMIT 1;
  `, { replacements: { userId: decoded.userId } });

  return student || null;
}

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        data: null,
        message: 'Authorization token required.',
        errors: ['Missing or malformed Authorization header'],
      });
    }

    const token = header.split(' ')[1];

    // Bug 7 Fix: Use SHA-256 hash instead of storing full JWT as Redis key
    // This saves memory and keeps key size consistent
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Check if token is blacklisted in Redis (only if Redis is connected)
    if (redis.status === 'ready') {
      const isBlacklisted = await redis.get(`blacklist:${tokenHash}`);
      if (isBlacklisted) {
        return res.status(401).json({
          success: false,
          data: null,
          message: 'Token has been invalidated. Please log in again.',
          errors: ['Token blacklisted'],
        });
      }
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.studentId || decoded.role === 'student') {
      const student = await resolveStudentFromToken(decoded);

      if (!student || !student.is_active || student.is_deleted) {
        return res.status(401).json({
          success: false,
          data: null,
          message: 'Student account not found or deactivated.',
          errors: ['Authentication failed'],
        });
      }

      req.user = {
        id: student.id,
        student_id: student.id,
        school_id: student.school_id,
        name: [student.first_name, student.last_name].filter(Boolean).join(' ').trim(),
        admission_no: student.admission_no,
        role: 'student',
        is_active: student.is_active,
      };

      trackOnlineStatus(req.user);
      return next();
    }

    if (decoded.role === 'teacher') {
      const [[teacher]] = await sequelize.query(`
        SELECT id, school_id, first_name, last_name, email, is_active, is_deleted
        FROM teachers
        WHERE id = :id AND is_deleted = false
        LIMIT 1;
      `, { replacements: { id: decoded.userId } });

      if (!teacher || !teacher.is_active) {
        return res.status(401).json({
          success: false,
          data: null,
          message: 'Teacher account not found or deactivated.',
          errors: ['Authentication failed'],
        });
      }

      req.user = {
        id: teacher.id,
        school_id: teacher.school_id,
        name: `${teacher.first_name} ${teacher.last_name}`.trim(),
        email: teacher.email,
        role: 'teacher',
        is_active: teacher.is_active,
      };
      trackOnlineStatus(req.user);
      return next();
    }

    if (decoded.role === 'parent') {
      const [[profile]] = await sequelize.query(`
        SELECT sp.id, s.school_id, COALESCE(sp.father_name, sp.mother_name, 'Parent') as name, sp.parent_email as email
        FROM student_profiles sp
        JOIN students s ON s.id = sp.student_id
        WHERE sp.id = :id AND s.is_deleted = false AND sp.is_current = true
        LIMIT 1;
      `, { replacements: { id: decoded.userId } });

      if (!profile) {
        return res.status(401).json({
          success: false,
          data: null,
          message: 'Parent account not found.',
          errors: ['Authentication failed'],
        });
      }

      req.user = {
        id: profile.id,
        school_id: profile.school_id,
        name: profile.name,
        email: profile.email,
        role: 'parent',
        is_active: true,
      };
      trackOnlineStatus(req.user);
      return next();
    }

    const [[user]] = await sequelize.query(`
      SELECT id, school_id, name, email, role, is_active
      FROM users
      WHERE id = :id
      LIMIT 1;
    `, { replacements: { id: decoded.userId } });

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        data: null,
        message: 'Account not found or deactivated.',
        errors: ['Authentication failed'],
      });
    }

    req.user = {
      ...user,
      role: normalizeUserRole(user.role),
    };

    trackOnlineStatus(req.user);
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError'
      ? 'Token expired. Please log in again.'
      : 'Invalid token.';

    return res.status(401).json({
      success: false,
      data: null,
      message,
      errors: [err.message],
    });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  const normalizedRole = normalizeUserRole(req.user.role);

  if (!roles.includes(normalizedRole)) {
    return res.status(403).json({
      success: false,
      data: null,
      message: `Access denied. Required role: ${roles.join(' or ')}.`,
      errors: [`Your role '${normalizedRole}' is not permitted for this action`],
    });
  }
  next();
};

const requireAdmin = requireRole('admin');
const requireAdminOrTeacher = requireRole('admin', 'teacher');

module.exports = {
  authenticate,
  requireRole,
  requireAdmin,
  requireAdminOrTeacher,
};
