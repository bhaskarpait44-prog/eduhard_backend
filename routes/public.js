'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/publicController');

router.get('/sessions/current', ctrl.getCurrentSession);
router.get('/classes', ctrl.getClasses);
router.get('/applications/status', ctrl.getApplicationStatus);

module.exports = router;
