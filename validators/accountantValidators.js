'use strict';

const { body, query, param } = require('express-validator');

const collectFeesRules = [
  body('student_id').isInt().withMessage('Invalid student ID'),
  body('invoice_ids').isArray({ min: 1 }).withMessage('At least one invoice ID is required'),
  body('invoice_ids.*').isInt().withMessage('Invalid invoice ID in list'),
  body('amount').isDecimal({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('payment_mode').isIn(['cash', 'online', 'cheque', 'dd', 'upi']).withMessage('Invalid payment mode'),
  body('payment_date').isDate().withMessage('Invalid payment date'),
  body('reference').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('remarks').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('bank_name').optional({ nullable: true }).trim(),
  body('cheque_number').optional({ nullable: true }).trim(),
  body('cheque_date').optional({ nullable: true }).isDate(),
];

const createNoticeRules = [
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
  body('content').trim().notEmpty().withMessage('Content is required'),
  body('audience').isIn(['all_classes', 'class', 'section', 'student']).withMessage('Invalid audience'),
  body('class_id').optional({ nullable: true }).isInt(),
  body('section_id').optional({ nullable: true }).isInt(),
  body('student_id').optional({ nullable: true }).isInt(),
  body('expiry_date').optional({ nullable: true }).isDate(),
];

const applyConcessionRules = [
  body('invoice_id').isInt().withMessage('Invalid invoice ID'),
  body('concession_type').isIn(['percentage', 'fixed', 'full']).withMessage('Invalid concession type'),
  body('concession_value').isDecimal({ min: 0 }).withMessage('Invalid concession value'),
  body('reason').trim().notEmpty().withMessage('Reason is required'),
];

const feeStructureRules = [
  body('class_id').isInt().withMessage('Invalid class ID'),
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 150 }),
  body('amount').isDecimal({ min: 0 }).withMessage('Amount must be 0 or more'),
  body('frequency').isIn(['monthly', 'quarterly', 'annual', 'one_time']).withMessage('Invalid frequency'),
  body('due_day').isInt({ min: 1, max: 28 }).withMessage('Due day must be between 1 and 28'),
];

module.exports = {
  collectFeesRules,
  createNoticeRules,
  applyConcessionRules,
  feeStructureRules,
};
