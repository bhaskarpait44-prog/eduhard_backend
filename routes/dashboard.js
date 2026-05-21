'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/dashboardController');
const { requireRole } = require('../middlewares/auth');

router.get('/', requireRole('admin'), ctrl.getAdminStats);
router.get('/admin/stats', requireRole('admin'), ctrl.getAdminStats);

module.exports = router;
