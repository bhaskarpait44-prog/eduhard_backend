'use strict';

const Redis = require('ioredis');

const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  // Fix #9: parse port as integer — process.env values are always strings
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  // Fix #10: use undefined (not null) so ioredis skips the AUTH command entirely
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: !REDIS_ENABLED, // Don't connect if disabled
  connectTimeout: 2000, // Fail fast if Redis is down
  keepAlive: 30000, // Keep idle connection alive
  keyPrefix: 'eduhard:', // Partition keys for safe sharing
  // Fix #1: maxRetriesPerRequest has no effect when enableOfflineQueue is false
  // (commands are rejected immediately, never queued, so retries never happen).
  // Set to null to be explicit: don't retry individual commands.
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  retryStrategy(times) {
    if (!REDIS_ENABLED || times > 10) {
      if (REDIS_ENABLED) console.error('[Redis] Max retry attempts reached. Stopping retries.');
      return null;
    }
    return Math.min(times * 500, 5000);
  },
};

const redis = new Redis(redisConfig);

// Fix #8: track consecutive ECONNREFUSED to log throttled (first + every 10th)
let _econnrefusedCount = 0;

if (REDIS_ENABLED) {
  redis.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      _econnrefusedCount++;
      // Log first occurrence and every 10th thereafter so the issue is visible
      if (_econnrefusedCount === 1 || _econnrefusedCount % 10 === 0) {
        console.error(`[Redis] ECONNREFUSED — cannot reach ${redisConfig.host}:${redisConfig.port} (attempt #${_econnrefusedCount}). Is Redis running?`);
      }
    } else {
      console.error('[Redis] Error:', err.message);
    }
  });

  redis.on('connect', () => {
    _econnrefusedCount = 0; // reset counter on successful connection
    console.log('[Redis] Connected to server.');
  });
} else {
  console.log('[Redis] Caching is disabled via REDIS_ENABLED=false');
}

module.exports = redis;
