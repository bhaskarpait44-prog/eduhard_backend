'use strict';
const router     = require('express').Router();
const { authenticate, requireAdmin } = require('../middlewares/auth');
const validate   = require('../middlewares/validate');
const ctrl       = require('../controllers/classController');
const subCtrl    = require('../controllers/subjectController');
const {
  createClassRules, updateClassRules,
  createSectionRules, updateSectionRules,
} = require('../validators/classValidators');
const { createSubjectRules, updateSubjectRules, reorderSubjectsRules } = require('../validators/subjectValidators');

// ── All routes require auth ───────────────────────────────────────────────
router.use(authenticate);

// ── Class CRUD ────────────────────────────────────────────────────────────
router.get   ('/',           ctrl.list);
router.get   ('/teachers',   requireAdmin, ctrl.getTeachers);
router.post  ('/',           requireAdmin, createClassRules, validate, ctrl.create);
router.get   ('/:id',        ctrl.getById);
router.get   ('/:id/students/pdf', ctrl.studentsPdf);
router.patch ('/:id',        requireAdmin, updateClassRules, validate, ctrl.update);
router.delete('/:id',        requireAdmin, ctrl.remove);
router.patch ('/:id/toggle', requireAdmin, ctrl.toggleActive);

// ── Section CRUD ──────────────────────────────────────────────────────────
router.get   ('/:id/sections',                    ctrl.getSections);
router.post  ('/:id/sections',                    requireAdmin, createSectionRules, validate, ctrl.createSection);
router.patch ('/:id/sections/:sectionId',         requireAdmin, updateSectionRules, validate, ctrl.updateSection);
router.delete('/:id/sections/:sectionId',         requireAdmin, ctrl.deleteSection);

// ── Subject CRUD ──────────────────────────────────────────────────────────
router.get   ('/:classId/subjects',               subCtrl.list);
router.post  ('/:classId/subjects',               requireAdmin, createSubjectRules, validate, subCtrl.create);
router.patch ('/:classId/subjects/reorder',       requireAdmin, reorderSubjectsRules, validate, subCtrl.reorder);
router.get   ('/:classId/subjects/:id',           subCtrl.getById);
router.patch ('/:classId/subjects/:id',           requireAdmin, updateSubjectRules, validate, subCtrl.update);
router.delete('/:classId/subjects/:id',           requireAdmin, subCtrl.remove);

module.exports = router;
