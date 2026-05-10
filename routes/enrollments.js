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

router.get('/promotion/candidates', requireAdmin, ctrl.promotionCandidates);
router.get('/promotion/summary/download', requireAdmin, ctrl.downloadPromotionSummaryPdf);
router.post('/promotion/process', requireAdmin, ctrl.processPromotions);
router.get('/:id',                     [param('id').isInt()], validate, ctrl.getById);
router.post('/promote', requireAdmin,  ctrl.promote);
router.post('/transfer', requireAdmin, ctrl.transfer);

module.exports = router;
