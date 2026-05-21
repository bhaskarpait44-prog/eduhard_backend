const { body } = require('express-validator');

exports.createUserValidator = [
  body('name').trim().notEmpty().withMessage('Full name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('role').isIn(['admin', 'teacher', 'accountant', 'student', 'parent', 'staff', 'librarian', 'receptionist'])
    .withMessage('Invalid role'),
  body('phone').optional({ checkFalsy: true }).isMobilePhone('en-IN').withMessage('Invalid Indian phone number'),
  body('employee_id').optional({ checkFalsy: true }).trim(),
  body('department').optional({ checkFalsy: true }).trim(),
  body('designation').optional({ checkFalsy: true }).trim(),
  body('joining_date').optional({ checkFalsy: true }).isDate().withMessage('Invalid joining date'),
  body('date_of_birth').optional({ checkFalsy: true }).isDate().withMessage('Invalid date of birth'),
  body('gender').optional({ checkFalsy: true }).isIn(['male', 'female', 'other']).withMessage('Invalid gender'),
  body('address').optional({ checkFalsy: true }).trim(),
  body('password').optional({ checkFalsy: true }).isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

exports.updateUserValidator = [
  body('name').optional().trim().notEmpty().withMessage('Full name is required'),
  body('phone').optional({ checkFalsy: true }).isMobilePhone('en-IN').withMessage('Invalid Indian phone number'),
  body('department').optional({ checkFalsy: true }).trim(),
  body('designation').optional({ checkFalsy: true }).trim(),
  body('joining_date').optional({ checkFalsy: true }).isDate().withMessage('Invalid joining date'),
  body('date_of_birth').optional({ checkFalsy: true }).isDate().withMessage('Invalid date of birth'),
  body('gender').optional({ checkFalsy: true }).isIn(['male', 'female', 'other']).withMessage('Invalid gender'),
  body('address').optional({ checkFalsy: true }).trim(),
];
