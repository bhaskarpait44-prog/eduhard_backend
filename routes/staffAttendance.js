'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/staffAttendanceController');
const { authenticate, requireRole } = require('../middlewares/auth');

// All staff attendance routes require authentication and admin/accountant role
router.use(authenticate);
router.use(requireRole('admin', 'accountant'));

router.get('/daily',    ctrl.getDailyAttendance);
router.post('/bulk',    ctrl.markBulk);
router.get('/register', ctrl.getMonthlyRegister);
router.get('/stats/:user_id', ctrl.getStaffSummary);

module.exports = router;
