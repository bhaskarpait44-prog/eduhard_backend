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
    const key = `cache:${schoolId}:${req.originalUrl}`;

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

  const keyPattern = `cache:${schoolId}:${pattern}`;
  
  try {
    const keys = await redis.keys(keyPattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Cache] Invalidated ${keys.length} keys for school ${schoolId}`);
    }
  } catch (err) {
    console.error('[Cache] Invalidation error:', err.message);
  }
};

module.exports = {
  cache,
  invalidateCache,
};
