'use strict';

const redis = require('../config/redis');

/**
 * Cache middleware for Express
 * @param {number} ttl - Time to live in seconds
 */
const cache = (ttl = 3600) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    // Skip if Redis is not connected
    if (redis.status !== 'ready') return next();

    const schoolId = req.user?.school_id || 'public';
    const role = req.user?.role || 'public';
    // Bug 10 Fix: Include role in cache key to prevent cross-role data leaks
    const key = `cache:${schoolId}:${role}:${req.originalUrl}`;

    try {
      const cachedData = await redis.get(key);
      if (cachedData) {
        return res.status(200).json(JSON.parse(cachedData));
      }

      // Override res.json to capture and cache the response
      const originalJson = res.json;
      res.json = function (body) {
        if (res.statusCode === 200) {
          redis.setex(key, ttl, JSON.stringify(body)).catch((err) => {
            console.error('[Cache] Set error:', err.message);
          });
        }
        return originalJson.call(this, body);
      };

      next();
    } catch (err) {
      console.error('[Cache] Get error:', err.message);
      next();
    }
  };
};

/**
 * Invalidate cache by school ID and pattern
 * @param {string|number} schoolId 
 * @param {string} pattern - optional pattern to match after schoolId
 */
const invalidateCache = async (schoolId, pattern = '*') => {
  if (!schoolId) return;

  // Skip if Redis is not connected
  if (redis.status !== 'ready') return;

  // Bug 10/11: Wipe all roles for the given school and pattern
  const keyPattern = `cache:${schoolId}:*:${pattern}`;
  
  try {
    // Bug 3 Fix: Use SCAN instead of KEYS to avoid blocking the event loop
    let cursor = '0';
    const keys = [];
    
    do {
      const [nextCursor, foundKeys] = await redis.scan(cursor, 'MATCH', keyPattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Cache] Invalidated ${keys.length} keys for school ${schoolId} matching ${pattern}`);
    }
  } catch (err) {
    console.error('[Cache] Invalidation error:', err.message);
  }
};

module.exports = {
  cache,
  invalidateCache,
};
