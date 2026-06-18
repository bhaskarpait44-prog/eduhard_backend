'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/staffAttendanceController');
const { authenticate, requireRole } = require('../middlewares/auth');

// All staff attendance routes require authentication
router.use(authenticate);

router.get('/daily',    requireRole('admin', 'accountant'), ctrl.getDailyAttendance);
router.post('/bulk',    requireRole('admin', 'accountant'), ctrl.markBulk);
router.get('/register', requireRole('admin', 'accountant'), ctrl.getMonthlyRegister);
router.get('/stats/:staff_id', ctrl.getStaffSummary);

module.exports = router;
