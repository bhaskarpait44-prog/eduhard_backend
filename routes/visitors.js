'use strict';

const express = require('express');
const router = express.Router();
const visitorController = require('../controllers/visitorController');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);

// All visitor routes require receptionist or admin role
router.get('/', requireRole('receptionist', 'admin'), visitorController.listVisitors);
router.get('/stats', requireRole('receptionist', 'admin'), visitorController.getTodayStats);
router.post('/', requireRole('receptionist', 'admin'), visitorController.logVisitor);
router.patch('/:id/checkout', requireRole('receptionist', 'admin'), visitorController.checkoutVisitor);

module.exports = router;
