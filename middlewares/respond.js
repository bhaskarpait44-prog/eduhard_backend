'use strict';

/**
 * middlewares/respond.js
 * Attaches res.ok() and res.fail() helpers for consistent response shape.
 */

module.exports = (req, res, next) => {
  res.ok = (data, message = 'Success', statusCode = 200) =>
    res.status(statusCode).json({ success: true, data, message, errors: [] });

  res.fail = (message, errors = [], statusCode = 400) =>
    res.status(statusCode).json({ success: false, data: null, message, errors });

  next();
};