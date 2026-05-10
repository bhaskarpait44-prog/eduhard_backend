'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expenseController');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.use(requireRole('admin', 'accountant'));

router.get('/', ctrl.list);
router.get('/summary', ctrl.summary);
router.post('/', ctrl.create);
router.patch('/:id/status', ctrl.updateStatus);
router.delete('/:id', ctrl.remove);

module.exports = router;
