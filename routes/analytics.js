'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const { requireAdminOrTeacher } = require('../middlewares/auth');

router.get('/exams/:id', requireAdminOrTeacher, ctrl.getExamAnalytics);

module.exports = router;
