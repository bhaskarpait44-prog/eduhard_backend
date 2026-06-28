'use strict';

const router   = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireAdmin, requireRole } = require('../middlewares/auth');
const requireAdminOrTeacherOrAccountant = requireRole('admin', 'teacher', 'accountant', 'librarian', 'receptionist', 'student', 'parent');
const ctrl     = require('../controllers/sessionController');

router.post('/',                requireAdmin, [
  body('name').notEmpty().withMessage('Session name required').isLength({ max: 100 }).withMessage('Session name cannot exceed 100 characters'),
  body('start_date').isDate().withMessage('Valid start_date required (YYYY-MM-DD)'),
  body('end_date').isDate().withMessage('Valid end_date required (YYYY-MM-DD)'),
  body('working_days').isObject().withMessage('working_days object required'),
], validate, ctrl.create);

router.get('/',                            requireAdminOrTeacherOrAccountant, ctrl.list);
router.get('/current',                     requireAdminOrTeacherOrAccountant, ctrl.getCurrent);
router.get('/:id',               requireAdminOrTeacherOrAccountant, [param('id').isInt()], validate, ctrl.getById);

router.patch('/:id', requireAdmin, [
  param('id').isInt(),
  body('name').notEmpty().withMessage('Session name required').isLength({ max: 100 }).withMessage('Session name cannot exceed 100 characters'),
  body('start_date').isDate().withMessage('Valid start_date required'),
  body('end_date').isDate().withMessage('Valid end_date required'),
], validate, ctrl.update);

router.delete('/:id', requireAdmin, [param('id').isInt()], validate, ctrl.remove);

router.patch('/:id/activate', requireAdmin, [
  param('id').isInt().withMessage('Session id must be integer'),
], validate, ctrl.activate);

router.patch('/:id/lock', requireAdmin, [
  param('id').isInt().withMessage('Session id must be integer'),
], validate, ctrl.lock);

router.patch('/:id/unlock', requireAdmin, [
  param('id').isInt().withMessage('Session id must be integer'),
], validate, ctrl.unlock);

router.patch('/:id/archive', requireAdmin, [
  param('id').isInt().withMessage('Session id must be integer'),
], validate, ctrl.archive);

router.get('/:id/stats', requireAdmin, [
  param('id').isInt().withMessage('Session id must be integer'),
], validate, ctrl.getStats);

router.patch('/:id/working-days', requireAdmin, [
  param('id').isInt(),
  body('working_days').isObject().withMessage('working_days object required'),
], validate, ctrl.updateWorkingDays);

router.get('/:id/holidays',      requireAdminOrTeacherOrAccountant, [param('id').isInt()], validate, ctrl.getHolidays);

router.post('/:id/holidays',  requireAdmin, [
  param('id').isInt(),
  body('holiday_date').isDate().withMessage('Valid holiday_date required'),
  body('end_date').optional().isDate().withMessage('Valid end_date required'),
  body('name').notEmpty().withMessage('Holiday name required').isLength({ max: 150 }).withMessage('Holiday name cannot exceed 150 characters'),
  body('type').isIn(['national', 'regional', 'school']).withMessage('Invalid holiday type'),
], validate, ctrl.addHoliday);

router.delete('/:id/holidays/:holidayId', requireAdmin, [
  param('id').isInt(),
  param('holidayId').isInt(),
], validate, ctrl.removeHoliday);

module.exports = router;
