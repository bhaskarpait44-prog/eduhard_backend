'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const { requireAdminOrTeacher } = require('../middlewares/auth');
const { cache } = require('../middlewares/cache');

router.get('/exams/:id', requireAdminOrTeacher, cache(600), ctrl.getExamAnalytics);

module.exports = router;
