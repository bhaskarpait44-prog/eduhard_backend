'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/settingsController');

router.get('/', requireRole('admin'), ctrl.getSettings);
router.put('/', requireRole('admin'), [
  body('upi_id').optional({ nullable: true }).isString().trim(),
], validate, ctrl.updateSettings);

module.exports = router;
