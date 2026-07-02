'use strict';

const router = require('express').Router();
const { requireRole } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/checkPermission');
const ctrl = require('../controllers/teacherController');
const chatCtrl = require('../controllers/chatController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer setup for homework/materials
const homeworkDir = 'uploads/homework';
const materialsDir = 'uploads/materials';
[homeworkDir, materialsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (req.path.includes('homework')) cb(null, homeworkDir);
    else cb(null, materialsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'application/x-pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/plain',
      'application/octet-stream' // Fallback for some clients
    ];
    
    const allowedExtensions = [
      '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.webp', '.txt'
    ];
    
    const ext = path.extname(file.originalname).toLowerCase();
    const isAllowedMime = allowedMimeTypes.includes(file.mimetype);
    const isAllowedExt = allowedExtensions.includes(ext);

    if (isAllowedMime || isAllowedExt) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed (${file.mimetype})! Supported: PDF, Images, Word, PPT, Excel, Text`), false);
    }
  }
});

const { body } = require('express-validator');
const validate = require('../middlewares/validate');

const markAttendanceValidators = [
  body('class_id').isInt({ min: 1 }).withMessage('class_id must be a positive integer'),
  body('section_id').isInt({ min: 1 }).withMessage('section_id must be a positive integer'),
  body('date').optional().isISO8601().withMessage('date must be in YYYY-MM-DD format'),
  body('records').isArray({ min: 1 }).withMessage('records must be a non-empty array'),
  body('records.*.enrollment_id').isInt({ min: 1 }).withMessage('records.*.enrollment_id must be a positive integer'),
  body('records.*.status').isIn(['present', 'absent', 'late', 'half_day']).withMessage('records.*.status must be one of: present, absent, late, half_day'),
  body('reason').optional({ nullable: true }).isString().withMessage('reason must be a string'),
  validate
];

router.use(requireRole('teacher'));

router.get('/dashboard', ctrl.dashboard);
router.get('/dashboard/today-schedule', ctrl.todaySchedule);
router.get('/dashboard/pending-tasks', ctrl.pendingTasks);
router.get('/dashboard/recent-activity', ctrl.recentActivity);

router.get('/my-classes', ctrl.myClasses);
router.get('/my-classes/:id/overview', ctrl.myClassOverview);

router.get('/attendance/status', ctrl.attendanceStatus);
router.get('/attendance/students', ctrl.attendanceStudents);
router.post('/attendance/mark', markAttendanceValidators, ctrl.markAttendance);
router.post('/attendance/bulk-mark', markAttendanceValidators, ctrl.bulkMarkAttendance);
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
router.post('/homework', requirePermission('classes.view'), upload.single('attachment'), ctrl.createHomework);
router.patch('/homework/:id', requirePermission('classes.view'), upload.single('attachment'), ctrl.updateHomework);
router.delete('/homework/:id', requirePermission('classes.view'), ctrl.deleteHomework);
router.get('/homework/:id/submissions', requirePermission('classes.view'), ctrl.homeworkSubmissions);
router.post('/homework/:id/submit', requirePermission('classes.view'), ctrl.submitHomeworkForStudent);
router.post('/homework/:id/grade', requirePermission('classes.view'), ctrl.gradeHomework);
router.post('/homework/:id/remind', requirePermission('classes.view'), ctrl.remindHomework);

router.get('/study-materials', requirePermission('classes.view'), ctrl.studyMaterialList);
router.post('/study-materials', requirePermission('classes.view'), upload.single('file'), ctrl.createStudyMaterial);
router.delete('/study-materials/:id', requirePermission('classes.view'), ctrl.deleteStudyMaterial);

router.get('/chat/contacts', requirePermission('classes.view'), chatCtrl.teacherContacts);
router.get('/chat/conversations', requirePermission('classes.view'), chatCtrl.teacherConversations);
router.post('/chat/conversations', requirePermission('classes.view'), chatCtrl.teacherCreateConversation);
router.get('/chat/conversations/:id/messages', requirePermission('classes.view'), chatCtrl.teacherConversationMessages);
router.post('/chat/conversations/:id/messages', requirePermission('classes.view'), chatCtrl.teacherSendMessage);

router.get('/leave/balance', ctrl.leaveBalance);
router.get('/leave/applications', ctrl.leaveApplications);
router.post('/leave/apply', ctrl.applyLeave);
router.patch('/leave/:id/cancel', ctrl.cancelLeave);

router.get('/profile', ctrl.profile);
router.patch('/profile/contact', ctrl.updateProfileContact);
router.post('/profile/change-password', ctrl.changePassword);
router.post('/profile/correction-request', ctrl.createCorrectionRequest);

module.exports = router;
