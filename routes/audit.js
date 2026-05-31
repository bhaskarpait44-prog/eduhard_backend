'use strict';

const router = require('express').Router();
const { requireAdmin } = require('../middlewares/auth');
const ctrl   = require('../controllers/auditController');

router.get('/logs',           requireAdmin, ctrl.getLogs);
router.get('/log/:id(\\d+)',   requireAdmin, ctrl.getDetail);
router.get('/admins',         requireAdmin, ctrl.getAdmins);
router.get('/admin/:admin_id(\\d+)', requireAdmin, ctrl.getByAdmin);
router.get('/:table/:record_id(\\d+)', requireAdmin, ctrl.getHistory);

module.exports = router;
