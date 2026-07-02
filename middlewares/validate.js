'use strict';

/**
 * middlewares/validate.js
 * Runs express-validator checks and returns consistent error responses.
 */

const { validationResult } = require('express-validator');
const fs = require('fs');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Cleanup uploaded files if any
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (e) => {
        if (e) console.error('[Cleanup] Failed to delete orphaned file:', req.file.path, e.message);
      });
    }
    if (req.files) {
      if (Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file.path) {
            fs.unlink(file.path, (e) => {
              if (e) console.error('[Cleanup] Failed to delete orphaned file:', file.path, e.message);
            });
          }
        }
      } else {
        for (const fileArr of Object.values(req.files)) {
          if (Array.isArray(fileArr)) {
            for (const file of fileArr) {
              if (file.path) {
                fs.unlink(file.path, (e) => {
                  if (e) console.error('[Cleanup] Failed to delete orphaned file:', file.path, e.message);
                });
              }
            }
          }
        }
      }
    }

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