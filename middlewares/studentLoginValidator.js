'use strict';

const { body } = require('express-validator');

const studentLoginValidation = [
  body('password').notEmpty().withMessage('password is required'),
  body().custom((value = {}) => {
    const hasIdentifier = typeof value.identifier === 'string' && value.identifier.trim();
    const hasAdmission = typeof value.admission_no === 'string' && value.admission_no.trim();
    const hasEmail = typeof value.email === 'string' && value.email.trim();

    if (!hasIdentifier && !hasAdmission && !hasEmail) {
      throw new Error('Provide email, admission_no, or identifier.');
    }

    return true;
  }),
];

module.exports = studentLoginValidation;
