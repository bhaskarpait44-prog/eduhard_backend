'use strict';

const router   = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireAdmin, requireAdminOrTeacher, requireRole } = require('../middlewares/auth');
const ctrl     = require('../controllers/studentController');
const multer   = require('multer');
const path     = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/students/documents'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

router.post('/',                  requireAdmin, [
  body('admission_no').notEmpty(),
  body('first_name').notEmpty(),
  body('last_name').notEmpty(),
  body('date_of_birth').isDate(),
  body('gender').isIn(['male', 'female', 'other']),
  body('profile.email').isEmail().withMessage('A valid student email is required'),
], validate, ctrl.admit);

router.get('/',                   requireRole('admin', 'teacher', 'receptionist'), ctrl.list);

router.get('/:id',                requireAdminOrTeacher, [
  param('id').isInt(),
], validate, ctrl.getById);

router.get('/:id/id-card/data',   requireAdminOrTeacher, [
  param('id').isInt(),
], validate, ctrl.getIdCardData);

router.get('/:id/tc/data',        requireAdminOrTeacher, [
  param('id').isInt(),
], validate, ctrl.getTcData);

router.get('/bulk/id-cards/data', requireAdminOrTeacher, ctrl.getBulkIdCardsData);

router.patch('/:id/identity',     requireAdmin, [
  param('id').isInt(),
  body('reason').isLength({ min: 10 }).withMessage('reason must be at least 10 characters'),
], validate, ctrl.updateIdentity);

router.patch('/:id/profile',      requireAdmin, [
  param('id').isInt(),
  body('change_reason').isLength({ min: 10 }).withMessage('change_reason must be at least 10 characters'),
], validate, ctrl.updateProfile);

router.patch('/:id/toggle-status', requireAdmin, [
  param('id').isInt(),
], validate, ctrl.toggleStatus);

router.post('/:id/reset-password', requireAdmin, [
  param('id').isInt(),
  body('new_password').optional({ nullable: true }).isLength({ min: 8 }).withMessage('new_password must be at least 8 characters'),
], validate, ctrl.resetPassword);

router.delete('/:id',             requireAdmin, [
  param('id').isInt(),
  body('confirm_name').trim().notEmpty().withMessage('confirm_name is required'),
  body('reason').optional({ nullable: true }).trim(),
], validate, ctrl.remove);

router.get('/:id/history',        requireAdminOrTeacher, [
  param('id').isInt(),
], validate, ctrl.getHistory);

// ── Documents ─────────────────────────────────────────────────────────────
router.get('/:id/documents',      requireAdminOrTeacher, [
  param('id').isInt(),
], validate, ctrl.getDocuments);

router.post('/:id/documents',     requireAdmin, upload.single('document'), [
  param('id').isInt(),
], validate, ctrl.uploadDocument);

router.delete('/:id/documents/:docId', requireAdmin, [
  param('id').isInt(),
  param('docId').isInt(),
], validate, ctrl.deleteDocument);

module.exports = router;
