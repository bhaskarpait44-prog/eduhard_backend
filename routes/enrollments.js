'use strict';

const router   = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireAdmin } = require('../middlewares/auth');
const ctrl     = require('../controllers/enrollmentController');

router.post('/',          requireAdmin, [
  body('student_id').isInt(),
  body('session_id').isInt(),
  body('class_id').isInt(),
  body('section_id').isInt(),
  body('stream').optional({ nullable: true, checkFalsy: true }).isIn(['regular', 'arts', 'commerce', 'science']),
  body('joining_type').isIn(['fresh', 'promoted', 'failed', 'transfer_in', 'rejoined']),
  body('joined_date').isDate(),
], validate, ctrl.enroll);

router.get('/promotion/candidates',      requireAdmin, ctrl.promotionCandidates);
router.get('/promotion/summary/download',requireAdmin, ctrl.downloadPromotionSummary);
router.post('/promotion/process',        requireAdmin, ctrl.processPromotions);
// FIX #1: Specific named routes must come BEFORE the /:id wildcard to avoid shadowing
router.post('/promote',                  requireAdmin, ctrl.promote);
router.post('/transfer',                 requireAdmin, [
  body('enrollment_id').isInt(),
  body('new_section_id').isInt(),
  body('reason').optional({ nullable: true }).isString(),
], validate, ctrl.transfer);
router.get('/:id',                       [param('id').isInt()], validate, ctrl.getById);

module.exports = router;
