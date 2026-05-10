'use strict';

const router = require('express').Router();
const { authenticate, requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/noticeController');
const { param, body, query } = require('express-validator');
const validate = require('../middlewares/validate');

router.use(authenticate);

// ── Admin ────────────────────────────────────────────────────────────────────
router.get('/admin', requireRole('admin'), [
  query('page').optional().isInt(),
  query('perPage').optional().isInt()
], validate, ctrl.listAllNotices);

router.post('/admin', requireRole('admin'), [
  body('title').notEmpty().withMessage('Title is required'),
  body('body').notEmpty().withMessage('Body is required'),
  body('audience').isIn(['school_wide', 'class', 'section', 'student']).withMessage('Invalid audience'),
  body('priority').optional().isIn(['normal', 'urgent', 'info']),
], validate, ctrl.createNotice);

router.patch('/admin/:id', requireRole('admin'), [
  param('id').isInt(),
  body('priority').optional().isIn(['normal', 'urgent', 'info']),
], validate, ctrl.updateNotice);

router.delete('/admin/:id', requireRole('admin'), [
  param('id').isInt()
], validate, ctrl.deleteNotice);

// ── Teacher ──────────────────────────────────────────────────────────────────
router.get('/teacher', requireRole('teacher'), ctrl.listTeacherNotices);

router.post('/teacher', requireRole('teacher'), [
  body('title').notEmpty().withMessage('Title is required'),
  body('body').notEmpty().withMessage('Body is required'),
  body('audience').isIn(['class', 'section']).withMessage('Teachers can only post to class or section'),
  body('target_class_id').notEmpty().isInt(),
  body('priority').optional().isIn(['normal', 'urgent', 'info']),
], validate, ctrl.createTeacherNotice);

router.patch('/teacher/:id', requireRole('teacher'), [
  param('id').isInt(),
  body('priority').optional().isIn(['normal', 'urgent', 'info']),
], validate, ctrl.updateTeacherNotice);

router.delete('/teacher/:id', requireRole('teacher'), [
  param('id').isInt()
], validate, ctrl.deleteTeacherNotice);

// ── Accountant ───────────────────────────────────────────────────────────────
router.post('/accountant', requireRole('admin', 'accountant'), [
  body('title').notEmpty().withMessage('Title is required'),
  body('body').notEmpty().withMessage('Body is required'),
  body('audience').isIn(['school_wide', 'class']).withMessage('Accountants can only post school-wide or class-level notices'),
  body('priority').optional().isIn(['normal', 'urgent', 'info']),
], validate, ctrl.createAccountantNotice);

// ── Student Portal ───────────────────────────────────────────────────────────
router.get('/student', ctrl.getStudentNotices);
router.post('/student/:id/read', [param('id').isInt()], validate, ctrl.markRead);
router.post('/student/:id/pin', [param('id').isInt()], validate, ctrl.pinNotice);
router.delete('/student/:id/pin', [param('id').isInt()], validate, ctrl.unpinNotice);

// ── Shared ───────────────────────────────────────────────────────────────────
router.get('/:id', [param('id').isInt()], validate, ctrl.getNoticeById);

module.exports = router;
