'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/transportController');
const { requireRole } = require('../middlewares/auth');

router.use(requireRole(['admin', 'accountant']));

router.get('/routes', ctrl.getRoutes);
router.post('/routes', ctrl.createRoute);
router.patch('/routes/:id', ctrl.updateRoute);
router.delete('/routes/:id', ctrl.deleteRoute);

router.post('/routes/:route_id/stops', ctrl.createStop);
router.patch('/stops/:id', ctrl.updateStop);
router.delete('/stops/:id', ctrl.deleteStop);

router.post('/assign', ctrl.assignStudent);

module.exports = router;
