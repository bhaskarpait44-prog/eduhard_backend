'use strict';
const { body, param } = require('express-validator');

// ── Class validators ──────────────────────────────────────────────────────
const createClassRules = [
  body('name')
    .notEmpty().withMessage('Class name is required')
    .isLength({ max: 100 }).withMessage('Name must be 100 chars or less'),

  body('display_name')
    .optional({ nullable: true })
    .isLength({ max: 100 }).withMessage('Display name must be 100 chars or less'),

  body('order_number')
    .notEmpty().withMessage('Order number is required')
    .isInt({ min: 1 }).withMessage('Order number must be a positive integer'),

  body('min_age')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 25 }).withMessage('Min age must be between 1 and 25'),

  body('max_age')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 30 }).withMessage('Max age must be between 1 and 30'),

  body()
    .custom(({ min_age, max_age }) => {
      if (min_age && max_age && parseInt(max_age) <= parseInt(min_age)) {
        throw new Error('Max age must be greater than min age');
      }
      return true;
    }),

  body('description')
    .optional({ nullable: true })
    .isLength({ max: 1000 }).withMessage('Description too long'),
];

const updateClassRules = [
  ...createClassRules.map(rule =>
    // Make all fields optional for PATCH
    rule.optional ? rule : rule.optional({ nullable: true })
  ),
  body('reason')
    .notEmpty().withMessage('Reason for change is required')
    .isLength({ min: 5 }).withMessage('Reason must be at least 5 characters'),
];

// ── Section validators ────────────────────────────────────────────────────
const createSectionRules = [
  body('name')
    .notEmpty().withMessage('Section name is required')
    .isLength({ max: 10 }).withMessage('Name must be 10 chars or less'),

  body('capacity')
    .notEmpty().withMessage('Capacity is required')
    .isInt({ min: 1, max: 200 }).withMessage('Capacity must be between 1 and 200'),
];

const updateSectionRules = [
  body('name')
    .optional()
    .isLength({ max: 10 }),
  body('capacity')
    .optional()
    .isInt({ min: 1, max: 200 }),
];

module.exports = {
  createClassRules,
  updateClassRules,
  createSectionRules,
  updateSectionRules,
};