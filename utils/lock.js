'use strict';
const redis = require('../config/redis');

/**
 * Acquire a distributed lock using Redis (NX/PX pattern)
 * @param {string} key - Lock identifier
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @returns {Promise<boolean>} - True if lock acquired, false otherwise
 */
const acquireLock = async (key, ttlMs = 5000) => {
  const token = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  if (redis.status !== 'ready') {
    console.warn(`[Lock] Redis is not ready (status: ${redis.status}). Lock for key "${key}" failed open!`);
    return token; // Fail open if Redis is down
  }
  
  const lockKey = `lock:${key}`;
  try {
    const result = await redis.set(lockKey, token, 'NX', 'PX', ttlMs);
    return result === 'OK' ? token : null;
  } catch (err) {
    console.error(`[Lock] Failed to acquire lock for key "${key}" due to error. Failing open!`, err.message);
    return token; // Fail open to not block execution
  }
};

/**
 * Release a distributed lock
 * @param {string} key - Lock identifier
 * @param {string} token - The unique token returned when lock was acquired
 */
const releaseLock = async (key, token) => {
  if (redis.status !== 'ready') {
    console.warn(`[Lock] Redis is not ready (status: ${redis.status}). Cannot release lock for key "${key}".`);
    return;
  }
  if (!token) {
    console.warn(`[Lock] Release lock called for key "${key}" without a token.`);
    return;
  }
  
  const lockKey = `lock:${key}`;
  try {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, lockKey, token);
  } catch (err) {
    console.error(`[Lock] Failed to release lock for key "${key}":`, err.message);
  }
};

/**
 * Acquire a distributed lock with retry backoff
 * @param {string} key - Lock identifier
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} retryDelayMs - Delay between retries in milliseconds
 * @returns {Promise<string|null>} - Fencing token if lock acquired, null otherwise
 */
const acquireLockWithRetry = async (key, ttlMs = 5000, maxRetries = 10, retryDelayMs = 100) => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const token = await acquireLock(key, ttlMs);
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return null;
};

module.exports = {
  acquireLock,
  releaseLock,
  acquireLockWithRetry,
};
