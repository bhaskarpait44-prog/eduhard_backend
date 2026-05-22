'use strict';

const router = require('express').Router();
const { body, param, query } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireAdmin, requireAdminOrTeacher } = require('../middlewares/auth');
const ctrl = require('../controllers/studentLeavingController');

// ── Dashboard / Summary ──────────────────────────────────────────────────────
router.get('/leaving-summary', requireAdminOrTeacher, [
  query('session_id').optional().isInt()
], validate, ctrl.getLeavingSummary);

// ── Left Students (Alumni / Leavers) ─────────────────────────────────────────
router.get('/left', requireAdminOrTeacher, ctrl.getLeftStudents);

// ── Graduated Students ───────────────────────────────────────────────────────
router.get('/graduated', requireAdminOrTeacher, ctrl.getGraduatedStudents);

// ── PDF Downloads ────────────────────────────────────────────────────────────
router.get('/left/download', requireAdminOrTeacher, ctrl.downloadLeftStudentsPdf);
router.get('/graduated/download', requireAdminOrTeacher, ctrl.downloadGraduatedStudentsPdf);

// ── Student Actions ──────────────────────────────────────────────────────────

// Mark as Left
router.patch('/:id/mark-left', requireAdmin, [
  param('id').isInt(),
  body('left_date').isDate().withMessage('Invalid left_date'),
  body('leaving_reason').notEmpty().withMessage('leaving_reason is required'),
  body('leaving_remarks').optional({ checkFalsy: true })
], validate, ctrl.markAsLeft);

// Mark as Graduated
router.patch('/:id/mark-graduated', requireAdmin, [
  param('id').isInt(),
  body('graduated_date').isDate().withMessage('graduated_date is required'),
  body('remarks').optional({ checkFalsy: true })
], validate, ctrl.markAsGraduated);

// Enrollment History
router.get('/:id/enrollment-history', requireAdminOrTeacher, [
  param('id').isInt()
], validate, ctrl.getEnrollmentHistory);

// Re-admit Student
router.post('/:id/readmit', requireAdmin, [
  param('id').isInt(),
  body('session_id').isInt().withMessage('session_id is required'),
  body('class_id').isInt().withMessage('class_id is required'),
  body('section_id').isInt().withMessage('section_id is required'),
  body('joined_date').isDate().withMessage('Invalid joined_date'),
  body('roll_number').optional({ checkFalsy: true })
], validate, ctrl.readmitStudent);

module.exports = router;
