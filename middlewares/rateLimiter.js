'use strict';

const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');

/**
 * A fail-safe wrapper for RedisStore that bypasses Redis if it's down
 */
class FailSafeRedisStore extends RedisStore {
  async init() {
    if (redis.status !== 'ready') {
      console.warn('[RateLimit] Redis not ready, skipping store initialization.');
      return;
    }
    return super.init();
  }

  async increment(key) {
    if (redis.status !== 'ready') {
      // Return 1 instead of 0 because express-rate-limit expects a positive integer
      return { totalHits: 1, resetTime: new Date(Date.now() + 60000) };
    }
    return super.increment(key);
  }

  async decrement(key) {
    if (redis.status !== 'ready') return;
    return super.decrement(key);
  }

  async resetKey(key) {
    if (redis.status !== 'ready') return;
    return super.resetKey(key);
  }
}

// Helper to create a rate limiter with the fail-safe store
const createLimiter = (max, windowMs, message) => {
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
    store: new FailSafeRedisStore({
      sendCommand: (...args) => {
        if (redis.status !== 'ready') {
          // Return a placeholder that won't crash the calling logic
          return Promise.resolve('OK'); 
        }
        return redis.call(...args);
      },
    }),
  });
};

/**
 * Global API rate limiter: 300 requests per 15 minutes
 */
const apiLimiter = createLimiter(300, 15 * 60 * 1000, 'Too many requests from this IP, please try again after 15 minutes.');

/**
 * Authentication rate limiter: 20 requests per 15 minutes
 */
const authLimiter = createLimiter(20, 15 * 60 * 1000, 'Too many login attempts, please try again after 15 minutes.');

module.exports = {
  apiLimiter,
  authLimiter,
};
