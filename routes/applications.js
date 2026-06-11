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
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only images and PDFs are allowed'));
  }
});

const { applicationLimiter } = require('../middlewares/rateLimiter');

// Public route
router.post('/', applicationLimiter, upload.fields([
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
]), publicCtrl.createApplication);

// Admin routes
router.use(authenticate, requireAdmin);

router.get('/next-admission-no', adminCtrl.getNextAdmissionNumber);

router.get('/:id/documents/:key', adminCtrl.streamDocument);

router.get('/', [
  query('status').optional().isIn(['pending', 'approved', 'rejected', 'admitted']),
  query('page').optional().isInt({ min: 1 }),
  query('perPage').optional().isInt({ min: 1, max: 100 }),
], validate, adminCtrl.list);

router.get('/:id', [
  param('id').isInt(),
], validate, adminCtrl.getById);

router.post('/:id/admit', [
  param('id').isInt(),
  body('admission_no').notEmpty(),
  body('section_id').isInt(),
  body('roll_number').optional(),
], validate, adminCtrl.admitStudent);

router.post('/:id/email', [
  param('id').isInt(),
  body('subject').notEmpty(),
  body('message').notEmpty(),
], validate, adminCtrl.sendEmail);

router.patch('/:id/status', [
  param('id').isInt(),
  body('status').isIn(['approved', 'rejected']),
  body('remarks').optional().isString(),
], validate, adminCtrl.updateStatus);

module.exports = router;
