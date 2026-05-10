'use strict';

/**
 * middlewares/validate.js
 * Runs express-validator checks and returns consistent error responses.
 */

const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success : false,
      data    : null,
      message : 'Validation failed.',
      errors  : errors.array().map(e => `${e.path}: ${e.msg}`),
    });
  }
  next();
};

module.exports = validate;