'use strict';

/**
 * Global error handler — catches anything not handled in controllers.
 */

const logger = require('../utils/logger');

module.exports = (err, req, res, next) => {
  logger.error(`[${req.method} ${req.path}]`, err.message);

  // Sequelize unique constraint
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      success: false, data: null,
      message: 'Duplicate record.',
      errors: err.errors.map(e => e.message),
    });
  }

  // Sequelize validation
  if (err.name === 'SequelizeValidationError') {
    return res.status(422).json({
      success: false, data: null,
      message: 'Validation error.',
      errors: err.errors.map(e => e.message),
    });
  }

  const status = err.status || 500;
  return res.status(status).json({
    success : false,
    data    : null,
    message : err.message || 'Internal server error.',
    errors  : process.env.NODE_ENV === 'development' ? [err.stack] : [],
  });
};