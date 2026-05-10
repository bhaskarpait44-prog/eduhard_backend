'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/payrollController');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.use(requireRole(['admin', 'accountant']));

router.get('/structures', ctrl.getStructures);
router.patch('/structures/:user_id', ctrl.updateStructure);

router.get('/', ctrl.getPayrolls);
router.post('/generate', ctrl.generatePayroll);
router.patch('/:id/pay', ctrl.markPaid);
router.get('/:id/payslip', ctrl.getPayslip);

module.exports = router;
