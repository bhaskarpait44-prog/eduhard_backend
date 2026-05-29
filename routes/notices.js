'use strict';

const router = require('express').Router();
const { authenticate, requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/noticeController');
const { param, body, query } = require('express-validator');
const validate = require('../middlewares/validate');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads/notices');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/notices'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  }
});

router.use(authenticate);

// ── Admin ────────────────────────────────────────────────────────────────────
router.get('/admin', requireRole('admin'), [
  query('page').optional().isInt(),
  query('perPage').optional().isInt()
], validate, ctrl.listAllNotices);

const adminUpload = upload.single('attachment');
router.post('/admin', requireRole('admin'), (req, res, next) => {
  adminUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}`, data: null, errors: [err.code] });
    } else if (err) {
      return res.status(err.status || 500).json({ success: false, message: err.message || 'File upload failed', data: null, errors: [err.stack].filter(Boolean) });
    }
    next();
  });
}, [
  body('title').notEmpty().withMessage('Title is required'),
  body('audience').notEmpty().withMessage('Audience is required'),
  body('priority').optional().isIn(['normal', 'urgent', 'info']),
  body().custom((val, { req }) => {
    if (!req.body.body && !req.body.content) {
      throw new Error('Notice body or content is required');
    }
    return true;
  }),
], validate, ctrl.createNotice);

router.patch('/admin/:id', requireRole('admin'), upload.single('attachment'), [
  param('id').isInt(),
], validate, ctrl.updateNotice);

router.delete('/admin/:id', requireRole('admin'), [
  param('id').isInt()
], validate, ctrl.deleteNotice);

// ── Teacher ──────────────────────────────────────────────────────────────────
router.get('/teacher', requireRole('teacher'), ctrl.listTeacherNotices);
router.post('/teacher/:id/read', requireRole('teacher'), [param('id').isInt()], validate, ctrl.markTeacherRead);

router.post('/teacher', requireRole('teacher'), upload.single('attachment'), [
  body('title').notEmpty().withMessage('Title is required'),
  body().custom((val, { req }) => {
    if (!req.body.body && !req.body.content) {
      throw new Error('Notice body or content is required');
    }
    return true;
  }),
  body('audience').isIn(['class', 'section', 'students', 'subject_wise']).withMessage('Invalid teacher audience'),
  body('priority').optional().isIn(['normal', 'urgent', 'info']),
], validate, ctrl.createNotice);

router.patch('/teacher/:id', requireRole('teacher'), upload.single('attachment'), [
  param('id').isInt(),
], validate, ctrl.updateNotice);

router.delete('/teacher/:id', requireRole('teacher'), [
  param('id').isInt()
], validate, ctrl.deleteNotice);

// ── Accountant ───────────────────────────────────────────────────────────────
router.get('/accountant', requireRole('admin', 'accountant'), ctrl.listAccountantNotices);
router.get('/accountant-portal', requireRole('admin', 'accountant'), ctrl.listAccountantPortalNotices);
router.post('/accountant-portal/:id/read', requireRole('admin', 'accountant'), [param('id').isInt()], validate, ctrl.markTeacherRead);

// ── Receptionist ─────────────────────────────────────────────────────────────
router.get('/receptionist', requireRole('receptionist', 'admin'), ctrl.listReceptionistNotices);
router.post('/receptionist/:id/read', requireRole('receptionist', 'admin'), [param('id').isInt()], validate, ctrl.markTeacherRead);

// ── Librarian ────────────────────────────────────────────────────────────────
router.get('/librarian', requireRole('librarian', 'admin'), ctrl.listLibrarianNotices);
router.post('/librarian/:id/read', requireRole('librarian', 'admin'), [param('id').isInt()], validate, ctrl.markTeacherRead);

router.post('/accountant', requireRole('admin', 'accountant'), upload.single('attachment'), [
  body('title').notEmpty().withMessage('Title is required'),
  body().custom((val, { req }) => {
    if (!req.body.body && !req.body.content) {
      throw new Error('Notice body or content is required');
    }
    return true;
  }),
  body('audience').isIn(['school_wide', 'class', 'students', 'parents']).withMessage('Invalid accountant audience'),
  body('priority').optional().isIn(['normal', 'urgent', 'info']),
], validate, ctrl.createNotice);

router.patch('/accountant/:id', requireRole('admin', 'accountant'), upload.single('attachment'), [
  param('id').isInt(),
], validate, ctrl.updateNotice);

// ── Student Portal ───────────────────────────────────────────────────────────
router.get('/student', requireRole('student'), ctrl.getStudentNotices);
router.post('/student/:id/read', requireRole('student'), [param('id').isInt()], validate, ctrl.markRead);
router.post('/student/:id/pin', requireRole('student'), [param('id').isInt()], validate, ctrl.pinNotice);
router.delete('/student/:id/pin', requireRole('student'), [param('id').isInt()], validate, ctrl.unpinNotice);

// ── Parent Portal ────────────────────────────────────────────────────────────
router.get('/parent', requireRole('parent'), ctrl.getParentNotices);
router.post('/parent/:id/read', requireRole('parent'), [param('id').isInt()], validate, ctrl.markParentRead);

// ── Shared ───────────────────────────────────────────────────────────────────
router.get('/:id', [param('id').isInt()], validate, ctrl.getNoticeById);

module.exports = router;
