'use strict';

const express = require('express');
const router = express.Router();
const complianceController = require('../controllers/complianceController');
const { requireRole } = require('../middlewares/auth');

// Only admins should see this report
router.get('/report', requireRole('admin'), complianceController.getReport);

module.exports = router;
