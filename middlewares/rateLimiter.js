'use strict';

const rateLimit = require('express-rate-limit');
const { MemoryStore } = rateLimit;
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
    this.options = options;
    this.redisStore = REDIS_ENABLED ? new RedisStore(options) : null;
    this.memoryStore = new MemoryStore();
    this.windowMs = options.windowMs || 60000;
  }

  async init(options) {
    this.windowMs = options.windowMs || this.windowMs;
    this.memoryStore.init(options);
    if (this.redisStore && typeof this.redisStore.init === 'function') {
      try {
        await this.redisStore.init(options);
      } catch (err) {
        // Initialization might fail if Redis is not yet connected.
      }
    }
  }

  async increment(key) {
    // If Redis is not ready, immediately use memory fallback
    if (!this.redisStore || redis.status !== 'ready') {
      return await this.memoryStore.increment(key);
    }
    try {
      return await this.redisStore.increment(key);
    } catch (err) {
      // If a command fails (e.g. connection lost), log once and fallback
      console.error('[RateLimit] Redis increment failed, falling back to MemoryStore:', err.message);
      return await this.memoryStore.increment(key);
    }
  }

  async decrement(key) {
    if (!this.redisStore || redis.status !== 'ready') {
      return await this.memoryStore.decrement(key);
    }
    try {
      await this.redisStore.decrement(key);
    } catch (err) {
      return await this.memoryStore.decrement(key);
    }
  }

  async resetKey(key) {
    if (!this.redisStore || redis.status !== 'ready') {
      return await this.memoryStore.resetKey(key);
    }
    try {
      await this.redisStore.resetKey(key);
    } catch (err) {
      return await this.memoryStore.resetKey(key);
    }
  }
}

const robustLimiter = (max, windowMs, message, keyPrefix) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    requestPropertyName: `rateLimit_${keyPrefix}`, // Fix ERR_ERL_DOUBLE_COUNT
    validate: { singleCount: false }, // Allow multiple different limiters
    message: {
      success: false,
      message: message || 'Too many requests, please try again later.',
      errors: ['Rate limit exceeded'],
    },
    store: new RobustRedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: `rl:${keyPrefix}:`,
      windowMs, // Pass windowMs to constructor as well
    }),
  });
};

/**
 * Global API rate limiter: 300 requests per 15 minutes
 */
const apiLimiter = robustLimiter(300, 15 * 60 * 1000, 'Too many requests from this IP, please try again after 15 minutes.', 'api');

/**
 * Authentication rate limiter: 20 requests per 15 minutes
 */
const authLimiter = robustLimiter(20, 15 * 60 * 1000, 'Too many login attempts, please try again after 15 minutes.', 'auth');

/**
 * Public admission application rate limiter: 5 submissions per hour
 */
const applicationLimiter = robustLimiter(5, 60 * 60 * 1000, 'Too many applications submitted from this IP. Please try again after an hour.', 'application');

module.exports = {
  apiLimiter,
  authLimiter,
  applicationLimiter,
};
