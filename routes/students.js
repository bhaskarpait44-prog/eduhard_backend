'use strict';

const router   = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const { authenticate, requireAdmin, requireAdminOrTeacher, requireRole } = require('../middlewares/auth');

router.use(authenticate);

const { requirePermission } = require('../middlewares/checkPermission');
const ctrl     = require('../controllers/studentController');
const { cache } = require('../middlewares/cache');
const multer   = require('multer');
const path     = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/students/documents'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit per file
});

// ── Bulk Import ──────────────────────────────────────────────────────────
router.get('/import/template', requirePermission('students.create'), ctrl.downloadAdmissionTemplate);
router.post('/import/preview',  requirePermission('students.create'), ctrl.previewAdmission);
router.post('/import/confirm',  requirePermission('students.create'), ctrl.confirmAdmission);
router.get('/import/:jobId/status', requirePermission('students.create'), ctrl.getAdmissionStatus);

router.get('/bulk/id-cards/data', requireRole('admin', 'teacher', 'receptionist', 'librarian'), ctrl.getBulkIdCardsData);

router.post('/',                  requireAdmin, upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'birth_certificate', maxCount: 1 },
  { name: 'transfer_certificate', maxCount: 1 },
  { name: 'marksheet', maxCount: 1 },
  { name: 'admit_card', maxCount: 1 },
  { name: 'pass_certificate', maxCount: 1 },
  { name: 'registration_certificate', maxCount: 1 },
  { name: 'character_certificate', maxCount: 1 },
  { name: 'prc', maxCount: 1 },
  { name: 'caste_certificate', maxCount: 1 },
  { name: 'blood_group_doc', maxCount: 1 },
  { name: 'aadhar_student', maxCount: 1 },
  { name: 'aadhar_father', maxCount: 1 },
  { name: 'aadhar_mother', maxCount: 1 }
]), [
  body('admission_no').notEmpty(),
  body('first_name').notEmpty(),
  body('last_name').notEmpty(),
  body('date_of_birth').isDate(),
  body('gender').isIn(['male', 'female', 'other']),
  // body('profile.email').isEmail().withMessage('A valid student email is required'), // Disabled because it might be in JSON string in FormData
], validate, ctrl.admit);

router.get('/',                   requireRole('admin', 'teacher', 'receptionist', 'librarian', 'accountant'), cache(300), ctrl.list);

router.get('/:id',                requireRole('admin', 'teacher', 'receptionist', 'librarian'), cache(600), [
  param('id').isInt(),
], validate, ctrl.getById);

router.get('/:id/id-card/data',   requireRole('admin', 'teacher', 'receptionist', 'librarian'), [
  param('id').isInt(),
], validate, ctrl.getIdCardData);

router.get('/:id/tc/data',        requireRole('admin', 'teacher', 'receptionist', 'librarian'), [
  param('id').isInt(),
], validate, ctrl.getTcData);

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

router.post('/:id/reset-parent-password', requireAdmin, [
  param('id').isInt(),
  body('new_password').optional({ nullable: true }).isLength({ min: 8 }).withMessage('new_password must be at least 8 characters'),
], validate, ctrl.resetParentPassword);

router.delete('/:id',             requireAdmin, [
  param('id').isInt(),
  body('confirm_name').trim().notEmpty().withMessage('confirm_name is required'),
  body('reason').optional({ nullable: true }).trim().isLength({ min: 10 }).withMessage('reason must be at least 10 characters'),
], validate, ctrl.remove);

// ── Results ───────────────────────────────────────────────────────────────
router.get('/:id/results', requirePermission('results.view'), [
  param('id').isInt(),
], validate, ctrl.getStudentResults);

router.get('/:id/results/:examId', requirePermission('results.view'), [
  param('id').isInt(),
  param('examId').isInt(),
], validate, ctrl.getStudentResultByExam);

router.get('/:id/timetable', requireRole('admin', 'teacher', 'receptionist', 'librarian'), [
  param('id').isInt(),
], validate, ctrl.getStudentTimetable);

router.get('/:id/summary', requireRole('admin', 'teacher', 'receptionist', 'librarian'), [
  param('id').isInt(),
], validate, ctrl.getStudentSummary);

router.get('/:id/history',        requireRole('admin', 'teacher', 'receptionist', 'librarian'), [
  param('id').isInt(),
], validate, ctrl.getHistory);

router.get('/:id/admission-form', requireRole('admin', 'teacher', 'receptionist', 'librarian'), [
  param('id').isInt(),
], validate, ctrl.downloadAdmissionForm);

// ── Documents ─────────────────────────────────────────────────────────────
router.get('/:id/documents',      requireRole('admin', 'teacher', 'receptionist', 'librarian'), [
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
