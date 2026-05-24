'use strict';

const Redis = require('ioredis');

const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || null,
  lazyConnect: !REDIS_ENABLED, // Don't connect if disabled
  maxRetriesPerRequest: 10,
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

if (REDIS_ENABLED) {
  redis.on('error', (err) => {
    // Only log connection errors if we actually expect Redis to be there
    if (err.code !== 'ECONNREFUSED') {
      console.error('[Redis] Error:', err.message);
    }
  });

  redis.on('connect', () => {
    console.log('[Redis] Connected to server.');
  });
} else {
  console.log('[Redis] Caching is disabled via REDIS_ENABLED=false');
}

module.exports = redis;
