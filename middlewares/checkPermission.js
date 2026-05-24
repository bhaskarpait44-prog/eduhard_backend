'use strict';
const sequelize = require('../config/database');
const { ADMIN_ROLES, DEFAULT_ROLE_PERMISSIONS } = require('../utils/permissionConstants');
const redis = require('../config/redis');

/**
 * Permission cache: user_id → Set of permission names
 * Cache TTL: 5 minutes.
 * Bug 8 Fix: Use Redis instead of in-process Map to support multi-process deployments
 */
const CACHE_TTL = 300; // 5 minutes in seconds for Redis

async function loadUserPermissions(userId, userRole = null) {
  const cacheKey = `perms:${userRole || 'user'}:${userId}`;
  
  // Try to load from Redis first
  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return new Set(JSON.parse(cached));
      }
    } catch (e) {
      console.error('[PermissionCache] Load error:', e.message);
    }
  }

  const tableName = userRole === 'teacher' ? 'teacher_permissions' : 'user_permissions';
  const idColumn = userRole === 'teacher' ? 'teacher_id' : 'user_id';

  const [rows] = await sequelize.query(`
    SELECT p.name
    FROM ${tableName} up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.${idColumn} = :userId;
  `, { replacements: { userId } });

  const permsArray = rows.map(r => r.name);
  const perms = new Set(permsArray);
  const defaults = DEFAULT_ROLE_PERMISSIONS[userRole] || [];
  defaults.forEach((permission) => perms.add(permission));
  
  // Save to Redis
  if (redis.status === 'ready') {
    try {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(Array.from(perms)));
    } catch (e) {
      console.error('[PermissionCache] Save error:', e.message);
    }
  }

  return perms;
}

async function teacherHasActiveAssignment(userId) {
  const [[row]] = await sequelize.query(`
    SELECT 1 AS has_assignment
    FROM teacher_assignments
    WHERE teacher_id = :userId
      AND is_active = true
    LIMIT 1;
  `, { replacements: { userId } });

  return Boolean(row?.has_assignment);
}

// Call this after any permission change to clear the cache for a user
async function clearPermissionCache(userId, userRole = 'user') {
  if (redis.status !== 'ready') return;

  try {
    if (userId) {
      const cacheKey = `perms:${userRole}:${userId}`;
      await redis.del(cacheKey);
    } else {
      // If no userId, wipe all perms (e.g. system-wide change)
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'perms:*', 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');
    }
  } catch (e) {
    console.error('[PermissionCache] Clear error:', e.message);
  }
}

/**
 * requirePermission(permissionName)
 *
 * Returns middleware that checks if the authenticated user has the given permission.
 * admin users bypass permission checks automatically.
 *
 * Usage:
 *   router.post('/fees/waive', authenticate, requirePermission('fees.waive'), ctrl.waive);
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.fail('Authentication required.', [], 401);
      }

      // Admins have all permissions
      if (ADMIN_ROLES.includes(user.role)) {
        return next();
      }

      const perms = await loadUserPermissions(user.id, user.role);

      if (!perms.has(permission)) {
        if (user.role === 'teacher' && permission === 'classes.view' && await teacherHasActiveAssignment(user.id)) {
          return next();
        }
        if (user.role === 'teacher' && permission === 'notices.post' && await teacherHasActiveAssignment(user.id)) {
          return next();
        }

        return res.status(403).json({
          success : false,
          data    : null,
          message : `You do not have permission to perform this action. Required: ${permission}`,
          errors  : [`missing_permission:${permission}`],
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * requireAnyPermission([...permissions])
 * Returns middleware that passes if user has AT LEAST ONE of the permissions.
 */
function requireAnyPermission(permissions = []) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.fail('Authentication required.', [], 401);
      if (ADMIN_ROLES.includes(user.role)) return next();

      const perms = await loadUserPermissions(user.id, user.role);
      const hasAny = permissions.some(p => perms.has(p));

      if (!hasAny) {
        return res.status(403).json({
          success : false,
          data    : null,
          message : `You do not have the required permissions. Need one of: ${permissions.join(', ')}`,
          errors  : permissions.map(p => `missing_permission:${p}`),
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * attachUserPermissions
 *
 * Middleware that loads and attaches user permissions to req.userPermissions.
 * Use this on routes that conditionally show data based on permissions.
 * Does not block — just enriches the request.
 */
async function attachUserPermissions(req, res, next) {
  try {
    if (!req.user) return next();
    if (req.user.role === 'student') {
      req.userPermissions = new Set();
      return next();
    }
    if (ADMIN_ROLES.includes(req.user.role)) {
      req.userPermissions = new Set(['*']); // wildcard = all
    } else {
      req.userPermissions = await loadUserPermissions(req.user.id, req.user.role);
    }
    next();
  } catch {
    req.userPermissions = new Set();
    next();
  }
}

module.exports = {
  requirePermission,
  requireAnyPermission,
  attachUserPermissions,
  clearPermissionCache,
  loadUserPermissions,
};
