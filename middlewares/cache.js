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

  // AI Insight Pattern Fix: Whenever dashboard is cleared, clear AI insights too
  // This is because AI insights are used as part of the dashboard/analytics view.
  const patterns = [pattern];
  if (pattern === '/api/dashboard*') {
    patterns.push('/api/ai-insights-module*');
  }
  
  try {
    for (const p of patterns) {
      const keyPattern = `cache:${schoolId}:*:${p}`;
      let cursor = '0';
      
      do {
        const [nextCursor, foundKeys] = await redis.scan(cursor, 'MATCH', keyPattern, 'COUNT', 100);
        cursor = nextCursor;
        if (foundKeys.length > 0) {
          await redis.del(...foundKeys);
        }
      } while (cursor !== '0');
    }
    console.log(`[Cache] Invalidated patterns ${patterns.join(', ')} for school ${schoolId}`);
  } catch (err) {
    console.error('[Cache] Invalidation error:', err.message);
  }
};

module.exports = {
  cache,
  invalidateCache,
};
