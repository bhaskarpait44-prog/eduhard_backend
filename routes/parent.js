'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/parentController');
const { requireRole } = require('../middlewares/auth');

router.use(requireRole('parent'));

router.get('/wards', ctrl.getWards);
router.get('/wards/:student_id/attendance', ctrl.getWardAttendance);
router.get('/wards/:student_id/fees', ctrl.getWardFees);
router.get('/wards/:student_id/results', ctrl.getWardResults);
router.get('/wards/:student_id/homework', ctrl.getWardHomework);

module.exports = router;
