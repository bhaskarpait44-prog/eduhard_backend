'use strict';

/**
 * utils/logger.js
 * Minimal centralized logger.
 * Prefixes output with timestamp + level.
 * Swap this with Winston/Pino in production if needed.
 */

const timestamp = () => new Date().toISOString();

const logger = {
  info:  (...args) => console.log(`[${timestamp()}] INFO `, ...args),
  warn:  (...args) => console.warn(`[${timestamp()}] WARN `, ...args),
  error: (...args) => console.error(`[${timestamp()}] ERROR`, ...args),
};

module.exports = logger;