'use strict';

const router = require('express').Router();
const { body } = require('express-validator');

const validate = require('../middlewares/validate');
const ctrl = require('../controllers/feeController');
const { requirePermission } = require('../middlewares/checkPermission');

// ─────────────────────────────────────────────
// 📦 Fee Structures
// ─────────────────────────────────────────────

// Get all fee structures
router.get('/structures',
  requirePermission('fees.view'),
  ctrl.getStructures
);

// Create fee structure
router.post('/structure',
  requirePermission('fees.edit'),
  [
    body('session_id').optional().isInt(),
    body('class_id').isInt(),
    body('name').notEmpty(),
    body('amount').isDecimal(),
    body('frequency').isIn(['monthly', 'quarterly', 'annual', 'one_time']),
    body('due_day').isInt({ min: 1, max: 28 }),
  ],
  validate,
  ctrl.createStructure
);

// Delete fee structure
router.delete('/structure/:id',
  requirePermission('fees.edit'),
  ctrl.deleteStructure
);

// ─────────────────────────────────────────────
// 💰 Payments
// ─────────────────────────────────────────────

// Record payment
router.post('/payment',
  requirePermission('fees.collect'),
  [
    body('invoice_id').isInt(),
    body('amount').isDecimal({ gt: '0' }),
    body('payment_date').isDate(),
    body('payment_mode').isIn(['cash', 'online', 'cheque', 'dd']),
  ],
  validate,
  ctrl.recordPayment
);

// Carry forward dues
router.post('/carry-forward',
  requirePermission('fees.collect'),
  [
    body('student_id').isInt(),
    body('from_session_id').isInt(),
    body('to_session_id').isInt(),
  ],
  validate,
  ctrl.carryForward
);

// ─────────────────────────────────────────────
// 📊 Reports & Generation
// ─────────────────────────────────────────────

// Generate fees
router.post('/generate',
  requirePermission('fees.edit'),
  [
    body('session_id').isInt(),
  ],
  validate,
  ctrl.generate
);

// Fee reports
router.get('/report',
  requirePermission('fees.report'),
  ctrl.getReport
);

// Dashboard summary
router.get('/dashboard',
  requirePermission('fees.view'),
  ctrl.getDashboard
);

// Invoice register
router.get('/invoices',
  requirePermission('fees.view'),
  ctrl.getInvoices
);

// Receipts register
router.get('/receipts',
  requirePermission('fees.view'),
  ctrl.getReceipts
);

// Defaulters list
router.get('/defaulters',
  requirePermission('fees.view'),
  ctrl.getDefaulters
);

router.get('/defaulters/download',
  requirePermission('fees.view'),
  ctrl.downloadDefaultersPdf
);

// Get student fee details
router.get('/:enrollment_id',
  requirePermission('fees.view'),
  ctrl.getStudentFees
);

module.exports = router;
