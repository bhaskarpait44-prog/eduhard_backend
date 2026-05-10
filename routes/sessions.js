'use strict';

const router   = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireAdmin } = require('../middlewares/auth');
const ctrl     = require('../controllers/sessionController');

router.post('/',                requireAdmin, [
  body('name').notEmpty().withMessage('Session name required'),
  body('start_date').isDate().withMessage('Valid start_date required (YYYY-MM-DD)'),
  body('end_date').isDate().withMessage('Valid end_date required (YYYY-MM-DD)'),
  body('working_days').isObject().withMessage('working_days object required'),
], validate, ctrl.create);

router.get('/',                            ctrl.list);
router.get('/current',                     ctrl.getCurrent);
router.get('/:id',               [param('id').isInt()], validate, ctrl.getById);

router.patch('/:id/activate', requireAdmin, [
  param('id').isInt().withMessage('Session id must be integer'),
], validate, ctrl.activate);

router.get('/:id/holidays',      [param('id').isInt()], validate, ctrl.getHolidays);

router.post('/:id/holidays',  requireAdmin, [
  param('id').isInt(),
  body('holiday_date').isDate().withMessage('Valid holiday_date required'),
  body('name').notEmpty().withMessage('Holiday name required'),
  body('type').isIn(['national', 'regional', 'school']).withMessage('Invalid holiday type'),
], validate, ctrl.addHoliday);

module.exports = router;
