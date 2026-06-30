'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/publicController');

const { authenticate } = require('../middlewares/auth');

router.get('/sessions/current', ctrl.getCurrentSession);
router.get('/classes', ctrl.getClasses);
router.get('/applications/status', ctrl.getApplicationStatus);
router.get('/check-uniqueness', authenticate, ctrl.checkUniqueness);

module.exports = router;
