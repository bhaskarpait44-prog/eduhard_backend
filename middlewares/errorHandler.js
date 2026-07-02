'use strict';

/**
 * Global error handler — catches anything not handled in controllers.
 */

const logger = require('../utils/logger');

module.exports = (err, req, res, next) => {
  logger.error(`[${req.method} ${req.path}]`, err.message);

  const originalError = err.original || err.parent || err;
  const isUniqueViolation = err.name === 'SequelizeUniqueConstraintError' || originalError?.code === '23505';

  if (isUniqueViolation) {
    const constraint = originalError?.constraint || '';
    let message = 'Duplicate record.';
    
    if (constraint.includes('idx_profiles_phone_unique')) {
      message = 'Student Phone Number already exists.';
    } else if (constraint.includes('idx_profiles_email_unique')) {
      message = 'Student email already exists.';
    } else if (constraint.includes('idx_profiles_parent_email_unique')) {
      message = 'Parent login email already exists.';
    } else if (constraint.includes('idx_profiles_father_phone_unique')) {
      message = 'Father Phone Number already exists.';
    } else if (constraint.includes('idx_profiles_mother_phone_unique')) {
      message = 'Mother Phone Number already exists.';
    } else if (constraint.includes('idx_profiles_guardian_phone_unique')) {
      message = 'Guardian Phone Number already exists.';
    } else if (constraint.includes('idx_profiles_mother_email_unique')) {
      message = 'Mother email already exists.';
    } else if (constraint.includes('idx_profiles_father_aadhar_unique')) {
      message = 'Father Aadhar already exists.';
    } else if (constraint.includes('idx_profiles_mother_aadhar_unique')) {
      message = 'Mother Aadhar already exists.';
    } else if (constraint.includes('idx_profiles_guardian_aadhar_unique')) {
      message = 'Guardian Aadhar Number already exists.';
    } else if (constraint.includes('idx_students_aadhar_no_unique')) {
      message = 'Aadhar Card No. already exists.';
    } else if (constraint.includes('admission_no')) {
      message = 'Admission number already exists.';
    } else if (err.errors && err.errors[0]?.message) {
      message = err.errors[0].message;
    }
    
    return res.status(409).json({
      success: false,
      data: null,
      message,
      errors: err.errors ? err.errors.map(e => e.message) : [message],
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