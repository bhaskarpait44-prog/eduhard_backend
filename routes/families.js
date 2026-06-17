'use strict';
const express  = require('express');
const router   = express.Router();
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const ctrl     = require('../controllers/familyController');
const { requireRole } = require('../middlewares/auth');

router.use(requireRole('admin', 'accountant'));

const familyRules = [
  body('family_name').trim().notEmpty().withMessage('Family name is required.').isLength({ max: 150 }),
  body('primary_contact').trim().notEmpty().withMessage('Primary contact name is required.').isLength({ max: 150 }),
  body('phone').trim().notEmpty().withMessage('Phone number is required.').isLength({ max: 20 }),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Must be a valid email.'),
  body('user_id').optional({ checkFalsy: true }).isInt({ gt: 0 }).withMessage('User ID must be a positive integer.'),
  body('student_ids').optional().isArray().withMessage('student_ids must be an array.'),
  body('student_ids.*').optional().isInt({ gt: 0 }).withMessage('Each student ID must be a positive integer.'),
];

router.get('/',                   ctrl.list);
router.post('/',                  familyRules, validate, ctrl.create);
router.patch('/:id',              [param('id').isInt({ gt: 0 }), ...familyRules], validate, ctrl.update);
router.delete('/:id',             param('id').isInt({ gt: 0 }), validate, ctrl.remove);
router.get('/student/:student_id', param('student_id').isInt({ gt: 0 }), validate, ctrl.getStudentFamily);

module.exports = router;
