'use strict';

const router = require('express').Router();
const { requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/adminTeacherControlController');

router.use(requireRole('admin'));

router.get('/overview', ctrl.overview);
router.get('/teachers', ctrl.teachers);

router.get('/assignments', ctrl.assignments);
router.post('/assignments', ctrl.createAssignment);
router.patch('/assignments/:id', ctrl.updateAssignment);

router.get('/timetable', ctrl.timetable);
router.post('/timetable', ctrl.createTimetableSlot);
router.patch('/timetable/:id', ctrl.updateTimetableSlot);

router.get('/homework', ctrl.homework);
router.patch('/homework/:id', ctrl.updateHomework);

router.get('/attendance', ctrl.attendance);
router.patch('/attendance/:id', ctrl.updateAttendance);

router.get('/marks', ctrl.marks);
router.patch('/marks/:id', ctrl.updateMark);

router.get('/remarks', ctrl.remarks);
router.patch('/remarks/:id', ctrl.updateRemark);

router.get('/leave', ctrl.leaves);
router.patch('/leave/:id/review', ctrl.reviewLeave);

router.get('/correction-requests', ctrl.correctionRequests);
router.patch('/correction-requests/:id/review', ctrl.reviewCorrectionRequest);

router.get('/student-correction-requests', ctrl.studentCorrectionRequests);
router.patch('/student-correction-requests/:id/review', ctrl.reviewStudentCorrectionRequest);

// Leaves
router.patch('/leave/:id/revoke', ctrl.revokeLeave);
router.get('/leave/balances', ctrl.getLeaveBalances);
router.patch('/leave/balances/:teacher_id', ctrl.updateLeaveBalance);

module.exports = router;
