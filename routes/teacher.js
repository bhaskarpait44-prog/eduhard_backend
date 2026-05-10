'use strict';

const router = require('express').Router();
const { requireRole } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/checkPermission');
const ctrl = require('../controllers/teacherController');
const chatCtrl = require('../controllers/chatController');

router.use(requireRole('teacher'));

router.get('/dashboard', ctrl.dashboard);
router.get('/dashboard/today-schedule', ctrl.todaySchedule);
router.get('/dashboard/pending-tasks', ctrl.pendingTasks);
router.get('/dashboard/recent-activity', ctrl.recentActivity);

router.get('/my-classes', ctrl.myClasses);
router.get('/my-classes/:id/overview', ctrl.myClassOverview);

router.get('/attendance/status', ctrl.attendanceStatus);
router.get('/attendance/students', ctrl.attendanceStudents);
router.post('/attendance/mark', ctrl.markAttendance);
router.post('/attendance/bulk-mark', ctrl.bulkMarkAttendance);
router.patch('/attendance/:id', ctrl.updateAttendance);
router.get('/attendance/register', ctrl.attendanceRegister);
router.get('/attendance/reports/summary', ctrl.attendanceSummaryReport);
router.get('/attendance/reports/below-threshold', ctrl.attendanceBelowThresholdReport);
router.get('/attendance/reports/chronic-absentees', ctrl.attendanceChronicAbsentees);

router.get('/marks/exams', ctrl.marksExams);
router.get('/marks/entry', ctrl.marksEntry);
router.post('/marks/save', ctrl.saveMark);
router.post('/marks/bulk-save', ctrl.bulkSaveMarks);
router.post('/marks/submit', ctrl.submitMarks);
router.get('/marks/summary', ctrl.marksSummary);

router.get('/students', requirePermission('classes.view'), ctrl.studentList);
router.get('/students/:id', requirePermission('classes.view'), ctrl.studentDetail);
router.get('/students/:id/attendance', requirePermission('classes.view'), ctrl.studentAttendance);
router.get('/students/:id/results', requirePermission('classes.view'), ctrl.studentResults);
router.get('/students/:id/remarks', requirePermission('classes.view'), ctrl.studentRemarks);

router.get('/remarks', requirePermission('classes.view'), ctrl.remarksList);
router.post('/remarks', requirePermission('classes.view'), ctrl.createRemark);
router.patch('/remarks/:id', requirePermission('classes.view'), ctrl.updateRemark);
router.get('/remarks/student/:id', requirePermission('classes.view'), ctrl.studentRemarkTimeline);

router.get('/timetable', requirePermission('classes.view'), ctrl.timetable);
router.get('/timetable/today', requirePermission('classes.view'), ctrl.timetableToday);
router.get('/timetable/current-period', requirePermission('classes.view'), ctrl.currentPeriod);
router.get('/exam-timetable', requirePermission('classes.view'), ctrl.examTimetable);

router.get('/homework', requirePermission('classes.view'), ctrl.homeworkList);
router.post('/homework', requirePermission('classes.view'), ctrl.createHomework);
router.patch('/homework/:id', requirePermission('classes.view'), ctrl.updateHomework);
router.delete('/homework/:id', requirePermission('classes.view'), ctrl.deleteHomework);
router.get('/homework/:id/submissions', requirePermission('classes.view'), ctrl.homeworkSubmissions);
router.post('/homework/:id/submit', requirePermission('classes.view'), ctrl.submitHomeworkForStudent);
router.post('/homework/:id/grade', requirePermission('classes.view'), ctrl.gradeHomework);
router.post('/homework/:id/remind', requirePermission('classes.view'), ctrl.remindHomework);

router.get('/chat/contacts', requirePermission('classes.view'), chatCtrl.teacherContacts);
router.get('/chat/conversations', requirePermission('classes.view'), chatCtrl.teacherConversations);
router.post('/chat/conversations', requirePermission('classes.view'), chatCtrl.teacherCreateConversation);
router.get('/chat/conversations/:id/messages', requirePermission('classes.view'), chatCtrl.teacherConversationMessages);
router.post('/chat/conversations/:id/messages', requirePermission('classes.view'), chatCtrl.teacherSendMessage);

router.get('/notices', requirePermission('notices.view'), ctrl.noticeList);
router.post('/notices', requirePermission('notices.post'), ctrl.createNotice);
router.patch('/notices/:id', requirePermission('notices.post'), ctrl.updateNotice);
router.post('/notices/:id/read', requirePermission('notices.view'), ctrl.readNotice);

router.get('/leave/balance', ctrl.leaveBalance);
router.get('/leave/applications', ctrl.leaveApplications);
router.post('/leave/apply', ctrl.applyLeave);
router.patch('/leave/:id/cancel', ctrl.cancelLeave);

router.get('/profile', ctrl.profile);
router.patch('/profile/contact', ctrl.updateProfileContact);
router.post('/profile/change-password', ctrl.changePassword);
router.post('/profile/correction-request', ctrl.createCorrectionRequest);

module.exports = router;
