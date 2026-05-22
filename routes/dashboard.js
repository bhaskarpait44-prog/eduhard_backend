'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/dashboardController');
const { requireRole } = require('../middlewares/auth');
const { cache } = require('../middlewares/cache');

router.get('/', requireRole('admin'), cache(300), ctrl.getAdminStats);
router.get('/admin/stats', requireRole('admin'), cache(300), ctrl.getAdminStats);

module.exports = router;
