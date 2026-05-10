'use strict';
const router = require('express').Router();
const { authenticate }   = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/checkPermission');
const ctrl = require('../controllers/userManagementController');

// All routes already have authenticate from app.js mount
// Apply granular permission checks per action:

router.get   ('/',                    requirePermission('users.view'),        ctrl.list);
router.post  ('/',                    requirePermission('users.create'),       ctrl.create);
router.get   ('/:id',                 requirePermission('users.view'),        ctrl.getById);
router.patch ('/:id',                 requirePermission('users.edit'),        ctrl.update);
router.delete('/:id',                 requirePermission('users.delete'),      ctrl.remove);
router.patch ('/:id/status',          requirePermission('users.edit'),        ctrl.toggleStatus);
router.patch ('/:id/permissions',     requirePermission('users.permissions'), ctrl.updatePermissions);
router.post  ('/:id/reset-password',  requirePermission('users.edit'),        ctrl.resetPassword);
router.get   ('/:id/audit',           requirePermission('audit.view'),        ctrl.getUserAudit);

// Bulk import
router.get  ('/import/template',  ctrl.downloadImportTemplate);
router.post ('/import/preview',   requirePermission('users.create'), ctrl.previewImport);
router.post ('/import/confirm',   requirePermission('users.create'), ctrl.confirmImport);
router.get  ('/import/:jobId/status', ctrl.importStatus);

module.exports = router;