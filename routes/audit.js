'use strict';

const router = require('express').Router();
const { requireAdmin } = require('../middlewares/auth');
const ctrl   = require('../controllers/auditController');

router.get('/logs',           requireAdmin, ctrl.getLogs);
router.get('/log/:id',        requireAdmin, ctrl.getDetail);
router.get('/admins',         requireAdmin, ctrl.getAdmins);
router.get('/admin/:admin_id',   requireAdmin, ctrl.getByAdmin);
router.get('/:table/:record_id', requireAdmin, ctrl.getHistory);

module.exports = router;
