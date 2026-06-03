'use strict';

const router = require('express').Router();
const publicCtrl = require('../controllers/publicController');
const adminCtrl = require('../controllers/applicationController');
const { authenticate, requireAdmin } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { body, param, query } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer storage for applications
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/applications';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only images and PDFs are allowed'));
  }
});

// Public route
router.post('/', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'birth_certificate', maxCount: 1 },
  { name: 'marksheet', maxCount: 1 }
]), publicCtrl.createApplication);

// Admin routes
router.use(authenticate, requireAdmin);

router.get('/', [
  query('status').optional().isIn(['pending', 'approved', 'rejected']),
  query('page').optional().isInt({ min: 1 }),
  query('perPage').optional().isInt({ min: 1, max: 100 }),
], validate, adminCtrl.list);

router.get('/:id', [
  param('id').isInt(),
], validate, adminCtrl.getById);

router.post('/:id/email', [
  param('id').isInt(),
  body('subject').notEmpty(),
  body('message').notEmpty(),
], validate, adminCtrl.sendEmail);

router.patch('/:id/status', [
  param('id').isInt(),
  body('status').isIn(['approved', 'rejected']),
  body('admission_no').if(body('status').equals('approved')).notEmpty().withMessage('Admission number required for approval'),
  body('section_id').if(body('status').equals('approved')).isInt().withMessage('Section ID required for approval'),
], validate, adminCtrl.updateStatus);

module.exports = router;
