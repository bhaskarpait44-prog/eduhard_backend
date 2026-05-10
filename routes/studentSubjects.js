'use strict';

const router = require('express').Router();
const { authenticate, requireAdmin, requireTeacher } = require('../middlewares/auth');
const ctrl = require('../controllers/studentSubjectController');

// All routes require auth
router.use(authenticate);

// Assign subjects to student (admin/teacher)
router.post('/assign', requireAdmin, ctrl.assignSubjects);

// Auto-assign core subjects to student
router.post('/auto-assign-core', requireAdmin, ctrl.autoAssignCoreSubjects);

// Get student's subjects
router.get('/:student_id/session/:session_id', requireAdmin, ctrl.getStudentSubjects);

// Remove subject from student
router.delete('/:student_id/session/:session_id/subject/:subject_id', requireAdmin, ctrl.removeSubject);

module.exports = router;
