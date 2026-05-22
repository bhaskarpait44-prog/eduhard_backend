'use strict';

const Redis = require('ioredis');

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || null,
  lazyConnect: true,
  // Set to null to allow ioredis to keep retrying in the background 
  // without failing the current request with MaxRetriesPerRequestError
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  retryStrategy(times) {
    // Keep retrying every 5 seconds if down
    return 5000;
  },
};

const redis = new Redis(redisConfig);

redis.on('error', (err) => {
  console.error('[Redis] Error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected to server.');
});

module.exports = redis;
