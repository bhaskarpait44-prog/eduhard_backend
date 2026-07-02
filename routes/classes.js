'use strict';
const router     = require('express').Router();
const { authenticate, requireAdmin, requireRole } = require('../middlewares/auth');
const validate   = require('../middlewares/validate');
const ctrl       = require('../controllers/classController');
const subCtrl    = require('../controllers/subjectController');
const {
  createClassRules, updateClassRules,
  createSectionRules, updateSectionRules,
  deleteClassRules, deleteSectionRules,
} = require('../validators/classValidators');
const { createSubjectRules, updateSubjectRules, reorderSubjectsRules, deleteSubjectRules } = require('../validators/subjectValidators');
const { cache }  = require('../middlewares/cache');

// ── All routes require auth ───────────────────────────────────────────────
router.use(authenticate);

// ── Class CRUD ────────────────────────────────────────────────────────────
router.get   ('/',           cache(300), ctrl.list);
router.get   ('/teachers',   requireAdmin, ctrl.getTeachers);
router.post  ('/',           requireAdmin, createClassRules, validate, ctrl.create);
router.get   ('/:id',        cache(600), ctrl.getById);
router.get   ('/:id/students/pdf', requireRole('admin', 'teacher', 'receptionist', 'librarian', 'accountant'), ctrl.studentsPdf);
router.get   ('/:id/students/pdf/simple', requireRole('admin', 'teacher', 'receptionist', 'librarian', 'accountant'), ctrl.simpleStudentsPdf);
router.patch ('/:id',        requireAdmin, updateClassRules, validate, ctrl.update);
router.delete('/:id',        requireAdmin, deleteClassRules, validate, ctrl.remove);
router.patch ('/:id/toggle', requireAdmin, ctrl.toggleActive);

// ── Section CRUD ──────────────────────────────────────────────────────────
router.get   ('/:id/sections',                    requireRole('admin', 'teacher', 'receptionist', 'librarian', 'accountant'), cache(300), ctrl.getSections);
router.post  ('/:id/sections',                    requireAdmin, createSectionRules, validate, ctrl.createSection);
router.patch ('/:id/sections/:sectionId',         requireAdmin, updateSectionRules, validate, ctrl.updateSection);
router.delete('/:id/sections/:sectionId',         requireAdmin, deleteSectionRules, validate, ctrl.deleteSection);

// ── Subject CRUD ──────────────────────────────────────────────────────────
router.get   ('/:classId/subjects/pdf',           requireRole('admin', 'teacher', 'receptionist', 'librarian', 'accountant'), subCtrl.downloadPdf);
router.get   ('/:classId/subjects',               requireRole('admin', 'teacher', 'receptionist', 'librarian', 'accountant'), cache(300), subCtrl.list);
router.post  ('/:classId/subjects',               requireAdmin, createSubjectRules, validate, subCtrl.create);
router.patch ('/:classId/subjects/reorder',       requireAdmin, reorderSubjectsRules, validate, subCtrl.reorder);
router.get   ('/:classId/subjects/:id',           requireRole('admin', 'teacher', 'receptionist', 'librarian', 'accountant'), cache(600), subCtrl.getById);
router.patch ('/:classId/subjects/:id',           requireAdmin, updateSubjectRules, validate, subCtrl.update);
router.delete('/:classId/subjects/:id',           requireAdmin, deleteSubjectRules, validate, subCtrl.remove);

module.exports = router;
