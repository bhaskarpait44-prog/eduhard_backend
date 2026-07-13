'use strict';
const redis = require('../config/redis');

/**
 * Acquire a distributed lock using Redis (NX/PX pattern)
 * @param {string} key - Lock identifier
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @returns {Promise<boolean>} - True if lock acquired, false otherwise
 */
const acquireLock = async (key, ttlMs = 5000) => {
  if (redis.status !== 'ready') return true; // Fail open if Redis is down
  
  const lockKey = `lock:${key}`;
  try {
    const result = await redis.set(lockKey, 'locked', 'NX', 'PX', ttlMs);
    return result === 'OK';
  } catch (err) {
    console.error(`[Lock] Failed to acquire lock for key ${key}:`, err.message);
    return true; // Fail open to not block execution
  }
};

/**
 * Release a distributed lock
 * @param {string} key - Lock identifier
 */
const releaseLock = async (key) => {
  if (redis.status !== 'ready') return;
  const lockKey = `lock:${key}`;
  try {
    await redis.del(lockKey);
  } catch (err) {
    console.error(`[Lock] Failed to release lock for key ${key}:`, err.message);
  }
};

/**
 * Acquire a distributed lock with retry backoff
 * @param {string} key - Lock identifier
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} retryDelayMs - Delay between retries in milliseconds
 * @returns {Promise<boolean>} - True if lock acquired, false otherwise
 */
const acquireLockWithRetry = async (key, ttlMs = 5000, maxRetries = 10, retryDelayMs = 100) => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const success = await acquireLock(key, ttlMs);
    if (success) return true;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return false;
};

module.exports = {
  acquireLock,
  releaseLock,
  acquireLockWithRetry,
};
