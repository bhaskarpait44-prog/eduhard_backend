'use strict';

/**
 * DISABLED RATE LIMITERS FOR TESTING
 */
const apiLimiter = (req, res, next) => next();
const authLimiter = (req, res, next) => next();

module.exports = {
  apiLimiter,
  authLimiter,
};
