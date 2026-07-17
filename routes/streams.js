'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireAdmin } = require('../middlewares/auth');
const ctrl = require('../controllers/streamController');

router.get('/', requireAdmin, ctrl.list);

router.post('/', requireAdmin, [
  body('name')
    .isString()
    .trim()
    .notEmpty().withMessage('Stream name is required')
    .isLength({ max: 50 }).withMessage('Stream name cannot exceed 50 characters')
    .matches(/^[a-zA-Z0-9\s-_]+$/).withMessage('Stream name can only contain letters, numbers, spaces, hyphens, and underscores'),
], validate, ctrl.create);

router.delete('/:id', requireAdmin, [
  param('id').isInt().withMessage('Invalid stream ID'),
], validate, ctrl.delete);

module.exports = router;
