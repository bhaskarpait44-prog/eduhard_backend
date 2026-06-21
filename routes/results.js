'use strict';

const router = require('express').Router();
const { body, param, query } = require('express-validator');

const validate = require('../middlewares/validate');
const ctrl = require('../controllers/resultController');
const { requirePermission } = require('../middlewares/checkPermission');

// ─────────────────────────────────────────────
// 📝 Enter Marks
// ─────────────────────────────────────────────
router.post('/enter',
  requirePermission('results.enter'),
  [
    body('exam_id').isInt(),
    body('enrollment_id').isInt(),
    body('results').isArray({ min: 1 }),
    body('results.*.subject_id').isInt(),
  ],
  validate,
  ctrl.enterMarks
);

// ─────────────────────────────────────────────
// ⚙️ Calculate Results
// ─────────────────────────────────────────────
router.post('/calculate',
  requirePermission('results.edit'),
  [
    body('enrollment_id').isInt(),
    body('session_id').isInt(),
  ],
  validate,
  ctrl.calculate
);

router.post('/bulk-calculate',
  requirePermission('results.edit'),
  [
    body('session_id').isInt(),
    body('class_id').isInt(),
    body('calculate').optional().isBoolean(),
    body('release').optional().isBoolean(),
  ],
  validate,
  ctrl.bulkCalculate
);

// ─────────────────────────────────────────────
// ✏️ Override Result (Admin-level)
// ─────────────────────────────────────────────
router.patch('/override',
  requirePermission('results.override'),
  [
    body('enrollment_id').isInt(),
    body('new_result').isIn(['pass', 'fail', 'compartment', 'detained']),
    body('reason').isLength({ min: 10 }),
    body('compartment_subjects')
      .if(body('new_result').equals('compartment'))
      .isArray({ min: 1 })
      .withMessage('compartment_subjects required when overriding to compartment'),
  ],
  validate,
  ctrl.override
);

router.patch('/release',
  requirePermission('results.override'),
  [
    body('enrollment_id').isInt(),
    body('release').isBoolean(),
  ],
  validate,
  ctrl.release
);

router.patch('/marks/override',
  requirePermission('results.override'),
  [
    body('exam_id').isInt(),
    body('enrollment_id').isInt(),
    body('subject_id').isInt(),
    body('is_absent').optional().isBoolean(),
    body('marks_obtained').optional({ nullable: true }),
    body('theory_marks_obtained').optional({ nullable: true }),
    body('practical_marks_obtained').optional({ nullable: true }),
    body('reason').isLength({ min: 5 }),
  ],
  validate,
  ctrl.overrideMark
);

router.get('/exam-marks',
  requirePermission('results.view'),
  ctrl.getExamMarks
);

// ─────────────────────────────────────────────
// 📊 Class Results
// ─────────────────────────────────────────────
router.get('/class',
  requirePermission('results.view'),
  ctrl.getClassResults
);

router.get('/class/download',
  requirePermission('results.view'),
  ctrl.downloadClassResultSheet
);

// ─────────────────────────────────────────────
// 👤 Student Result
// ─────────────────────────────────────────────
router.get('/:enrollment_id',
  requirePermission('results.view'),
  ctrl.getResults
);

router.get('/:enrollment_id/report-card',
  requirePermission('results.view'),
  ctrl.getReportCard
);

router.get('/:enrollment_id/report-card/data',
  requirePermission('results.view'),
  ctrl.getReportCardData
);

router.delete('/:enrollment_id',
  requirePermission('results.edit'),
  [
    param('enrollment_id').isInt(),
    query('session_id').isInt(),
  ],
  validate,
  ctrl.remove
);

module.exports = router;
