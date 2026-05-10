'use strict';

const router   = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireAdmin, requireAdminOrTeacher } = require('../middlewares/auth');
const ctrl     = require('../controllers/attendanceController');

router.post('/mark',    requireAdminOrTeacher, [
  body('enrollment_id').isInt(),
  body('date').isDate(),
  body('status').isIn(['present', 'absent', 'late', 'half_day', 'holiday']),
  body('method').isIn(['biometric', 'manual', 'auto']),
], validate, ctrl.markSingle);

router.post('/bulk',    requireAdminOrTeacher, [
  body('session_id').isInt(),
  body('section_id').isInt(),
  body('date').isDate(),
  body('records').isArray({ min: 1 }),
  body('records.*.enrollment_id').isInt(),
  body('records.*.status').isIn(['present', 'absent', 'late', 'half_day', 'holiday']),
], validate, ctrl.markBulk);

router.get('/class', requireAdminOrTeacher, ctrl.getClassAttendance);
router.get('/register', requireAdminOrTeacher, ctrl.getClassRegister);
router.get('/register/download', requireAdminOrTeacher, ctrl.downloadAttendanceRegisterPdf);
router.get('/report/:session_id', requireAdminOrTeacher, ctrl.sessionReport);
router.get('/:enrollment_id',     requireAdminOrTeacher, ctrl.getByEnrollment);

router.patch('/:id',  requireAdmin, [
  param('id').isInt(),
  body('status').isIn(['present', 'absent', 'late', 'half_day', 'holiday']),
  body('override_reason').isLength({ min: 10 }),
], validate, ctrl.override);

module.exports = router;
