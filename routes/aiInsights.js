'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/aiInsightsController');
const { requireRole } = require('../middlewares/auth');
const { cache } = require('../middlewares/cache');

router.get('/dashboard/ai-insights', requireRole('admin'), cache(600), ctrl.getDashboardInsights);
router.get('/dashboard/ai-risk-students', requireRole('admin', 'teacher'), cache(600), ctrl.getStudentRiskAnalysis);
router.get('/analytics/exams/:id/ai-insights', requireRole('admin', 'teacher'), cache(600), ctrl.getExamInsights);

module.exports = router;
