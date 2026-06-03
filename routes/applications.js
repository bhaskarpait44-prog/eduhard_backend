'use strict';

const router = require('express').Router();
const publicCtrl = require('../controllers/publicController');
const adminCtrl = require('../controllers/applicationController');
const { authenticate, requireAdmin } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { body, param, query } = require('express-validator');

// Public route
router.post('/', publicCtrl.createApplication);

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

router.patch('/:id/status', [
  param('id').isInt(),
  body('status').isIn(['approved', 'rejected']),
  body('admission_no').if(body('status').equals('approved')).notEmpty().withMessage('Admission number required for approval'),
  body('section_id').if(body('status').equals('approved')).isInt().withMessage('Section ID required for approval'),
], validate, adminCtrl.updateStatus);

module.exports = router;
