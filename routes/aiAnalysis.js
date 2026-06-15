'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/aiAnalysisController');
const { requireRole } = require('../middlewares/auth');
const { cache } = require('../middlewares/cache');

router.get('/dashboard-summary', requireRole('admin'), cache(600), ctrl.getDashboardSummary);

module.exports = router;
