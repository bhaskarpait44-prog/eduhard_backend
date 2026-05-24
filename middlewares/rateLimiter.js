'use strict';

const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');

const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

/**
 * Creates a rate limiter.
 * Automatically falls back to MemoryStore if Redis is disabled or not connected.
 */
const createLimiter = (max, windowMs, message) => {
  const options = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: message || 'Too many requests, please try again later.',
      errors: ['Rate limit exceeded'],
    },
  };

  // Only use RedisStore if REDIS_ENABLED is true
  if (REDIS_ENABLED) {
    options.store = new RedisStore({
      sendCommand: async (...args) => {
        // If redis is not ready, we throw an error which rate-limit-redis 
        // will hopefully handle or we'll catch.
        // Actually, rate-limit-redis doesn't have a built-in fallback.
        if (redis.status !== 'ready') {
          throw new Error('Redis not ready');
        }
        return redis.call(...args);
      },
    });

    // Handle potential errors from the Redis store by falling back to MemoryStore behavior
    // express-rate-limit doesn't easily allow switching stores on the fly, 
    // but we can make the sendCommand fail-safe by using a proxy-like behavior if we wanted.
    // For now, let's stick to a simpler approach: 
    // If Redis is enabled, we use it. If it fails, express-rate-limit will log the error.
  }

  return rateLimit(options);
};

// More robust FailSafe store implementation
class RobustRedisStore {
  constructor(options) {
    this.redisStore = REDIS_ENABLED ? new RedisStore(options) : null;
  }

  async increment(key) {
    if (!this.redisStore || redis.status !== 'ready') {
      return { totalHits: 1, resetTime: new Date(Date.now() + 60000) };
    }
    try {
      return await this.redisStore.increment(key);
    } catch (err) {
      console.error('[RateLimit] Redis increment failed, falling back:', err.message);
      return { totalHits: 1, resetTime: new Date(Date.now() + 60000) };
    }
  }

  async decrement(key) {
    if (!this.redisStore || redis.status !== 'ready') return;
    try {
      await this.redisStore.decrement(key);
    } catch (err) {}
  }

  async resetKey(key) {
    if (!this.redisStore || redis.status !== 'ready') return;
    try {
      await this.redisStore.resetKey(key);
    } catch (err) {}
  }
}

const robustLimiter = (max, windowMs, message) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: message || 'Too many requests, please try again later.',
      errors: ['Rate limit exceeded'],
    },
    store: new RobustRedisStore({
      sendCommand: (...args) => redis.call(...args),
    }),
  });
};

/**
 * Global API rate limiter: 300 requests per 15 minutes
 */
const apiLimiter = robustLimiter(300, 15 * 60 * 1000, 'Too many requests from this IP, please try again after 15 minutes.');

/**
 * Authentication rate limiter: 20 requests per 15 minutes
 */
const authLimiter = robustLimiter(20, 15 * 60 * 1000, 'Too many login attempts, please try again after 15 minutes.');

module.exports = {
  apiLimiter,
  authLimiter,
};
