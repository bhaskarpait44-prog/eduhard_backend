'use strict';

const { body, param } = require('express-validator');

const subjectTypeRule = body('subject_type')
  .optional()
  .isIn(['theory', 'practical', 'both'])
  .withMessage('subject_type must be theory, practical, or both');

const markRule = (field) =>
  body(field)
    .optional({ nullable: true })
    .isFloat({ gt: 0 })
    .withMessage(`${field} must be a positive number`);

const createSubjectRules = [
  param('classId').isInt({ min: 1 }).withMessage('Invalid class ID'),
  body('name')
    .trim()
    .notEmpty().withMessage('Subject name is required')
    .isLength({ max: 150 }).withMessage('Subject name max 150 chars'),
  body('code')
    .trim()
    .notEmpty().withMessage('Subject code is required')
    .isLength({ max: 30 }).withMessage('Subject code max 30 chars'),
  subjectTypeRule,
  body('is_core')
    .optional()
    .isBoolean().withMessage('is_core must be boolean'),
  body('order_number')
    .optional()
    .isInt({ min: 1 }).withMessage('order_number must be a positive integer'),
  markRule('theory_total_marks'),
  markRule('theory_passing_marks'),
  markRule('practical_total_marks'),
  markRule('practical_passing_marks'),
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 1000 }).withMessage('Description max 1000 chars'),
];

const updateSubjectRules = [
  param('classId').isInt({ min: 1 }).withMessage('Invalid class ID'),
  param('id').isInt({ min: 1 }).withMessage('Invalid subject ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Subject name cannot be empty')
    .isLength({ max: 150 }).withMessage('Subject name max 150 chars'),
  body('code')
    .optional()
    .trim()
    .notEmpty().withMessage('Subject code cannot be empty')
    .isLength({ max: 30 }).withMessage('Subject code max 30 chars'),
  subjectTypeRule,
  body('is_core')
    .optional()
    .isBoolean().withMessage('is_core must be boolean'),
  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active must be boolean'),
  body('order_number')
    .optional()
    .isInt({ min: 1 }).withMessage('order_number must be a positive integer'),
  markRule('theory_total_marks'),
  markRule('theory_passing_marks'),
  markRule('practical_total_marks'),
  markRule('practical_passing_marks'),
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 1000 }).withMessage('Description max 1000 chars'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Reason max 500 chars'),
];

const reorderSubjectsRules = [
  param('classId').isInt({ min: 1 }).withMessage('Invalid class ID'),
  body('subject_orders')
    .isArray({ min: 1 })
    .withMessage('subject_orders must be a non-empty array'),
  body('subject_orders.*.id')
    .isInt({ min: 1 })
    .withMessage('Each subject order must have a valid id'),
  body('subject_orders.*.order_number')
    .optional()
    .isInt({ min: 1 })
    .withMessage('order_number must be a positive integer'),
];

module.exports = {
  createSubjectRules,
  updateSubjectRules,
  reorderSubjectsRules,
};
