'use strict';

const { body, param } = require('express-validator');

const createClassRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Class name is required')
    .isLength({ max: 100 }).withMessage('Name max 100 chars'),
  body('order_number')
    .notEmpty().withMessage('Order number is required')
    .isInt({ min: 1 }).withMessage('Order number must be a positive integer'),
  body('stream')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isIn(['regular', 'arts', 'commerce', 'science']).withMessage('Stream must be Regular, Arts, Commerce, or Science'),
  body('display_name')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 }).withMessage('Display name max 100 chars'),
  body('min_age')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 25 }).withMessage('Min age must be 1-25'),
  body('max_age')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 30 }).withMessage('Max age must be 1-30'),
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 1000 }).withMessage('Description max 1000 chars'),
];

const updateClassRules = [
  param('id')
    .isInt().withMessage('Invalid class ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Class name cannot be empty')
    .isLength({ max: 100 }).withMessage('Name max 100 chars'),
  body('order_number')
    .optional()
    .isInt({ min: 1 }).withMessage('Order number must be a positive integer'),
  body('stream')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isIn(['regular', 'arts', 'commerce', 'science']).withMessage('Stream must be Regular, Arts, Commerce, or Science'),
  body('display_name')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 }).withMessage('Display name max 100 chars'),
  body('min_age')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 25 }).withMessage('Min age must be 1-25'),
  body('max_age')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 30 }).withMessage('Max age must be 1-30'),
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 1000 }).withMessage('Description max 1000 chars'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Reason max 500 chars'),
];

const createSectionRules = [
  param('id')
    .isInt().withMessage('Invalid class ID'),
  body('name')
    .trim()
    .notEmpty().withMessage('Section name is required')
    .isLength({ max: 50 }).withMessage('Name max 50 chars'),
  body('capacity')
    .optional({ nullable: true })
    .isInt({ min: 1 }).withMessage('Capacity must be positive'),
  body('class_teacher_id')
    .optional({ nullable: true })
    .isInt().withMessage('Invalid teacher ID'),
];

const updateSectionRules = [
  param('id')
    .isInt().withMessage('Invalid class ID'),
  param('sectionId')
    .isInt().withMessage('Invalid section ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Section name cannot be empty')
    .isLength({ max: 50 }).withMessage('Name max 50 chars'),
  body('capacity')
    .optional({ nullable: true })
    .isInt({ min: 1 }).withMessage('Capacity must be positive'),
  body('class_teacher_id')
    .optional({ nullable: true })
    .isInt().withMessage('Invalid teacher ID'),
  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active must be boolean'),
];

module.exports = {
  createClassRules,
  updateClassRules,
  createSectionRules,
  updateSectionRules,
};
