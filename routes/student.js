'use strict';

const router = require('express').Router();
const { requireRole } = require('../middlewares/auth');
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');
const ctrl = require('../controllers/studentPortalController');
const chatCtrl = require('../controllers/chatController');

router.use(requireRole('student'));

router.get('/dashboard', ctrl.dashboard);
router.get('/dashboard/today-schedule', ctrl.dashboardTodaySchedule);
router.get('/dashboard/upcoming-events', ctrl.dashboardUpcomingEvents);
router.get('/dashboard/achievements', ctrl.dashboardAchievements);

router.get('/attendance', ctrl.attendance);
router.get('/attendance/summary', ctrl.attendanceSummary);
router.get('/attendance/trend', ctrl.attendanceTrend);
router.get('/attendance/export', ctrl.attendanceExport);

router.get('/results', ctrl.results);
router.get('/results/export/:examId', [param('examId').isInt()], validate, ctrl.resultsExport);
router.get('/results/report-card/:examId', [param('examId').isInt()], validate, ctrl.reportCard);
router.get('/results/:examId', [param('examId').isInt()], validate, ctrl.resultByExam);

router.get('/fees', ctrl.fees);
router.get('/fees/summary', ctrl.feeSummary);
router.get('/fees/school-upi', ctrl.getSchoolUpi);
router.get('/fees/upi-payment-requests', ctrl.getUpiPaymentRequests);
router.post('/fees/upi-payment-request', [
  body('invoice_id').isInt(),
  body('amount').isNumeric(),
  body('upi_transaction_id').isString().isLength({ min: 8 }),
  body('student_note').optional({ nullable: true }).isString(),
], validate, ctrl.createUpiPaymentRequest);
router.get('/fees/payments', ctrl.feePayments);
router.get('/fees/receipts/:paymentId', [param('paymentId').isInt()], validate, ctrl.feeReceipt);
router.get('/fees/:invoiceId', [param('invoiceId').isInt()], validate, ctrl.feeInvoiceDetail);

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const submissionsDir = 'uploads/submissions';
if (!fs.existsSync(submissionsDir)) fs.mkdirSync(submissionsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, submissionsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'submission-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf', 'application/x-pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'application/octet-stream'
    ];
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.webp', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed (${file.mimetype})!`), false);
    }
  }
});

router.get('/timetable', ctrl.timetable);
router.get('/timetable/today', ctrl.timetableToday);
router.get('/timetable/current-period', ctrl.timetableCurrentPeriod);
router.get('/timetable/exam-schedule', ctrl.timetableExamSchedule);

router.get('/homework', ctrl.homeworkList);
router.get('/homework/submissions', ctrl.homeworkSubmissions);
router.get('/homework/:id', [param('id').isInt()], validate, ctrl.homeworkDetail);
router.post('/homework/:id/submit', upload.single('attachment'), [
  param('id').isInt(),
  body('submission_content').optional().isString(),
], validate, ctrl.homeworkSubmit);

router.get('/chat/contacts', chatCtrl.studentContacts);
router.get('/chat/conversations', chatCtrl.studentConversations);
router.post('/chat/conversations', [
  body('teacher_id').isInt(),
  body('subject_id').optional({ nullable: true }).isInt(),
], validate, chatCtrl.studentCreateConversation);
router.get('/chat/conversations/:id/messages', [param('id').isInt()], validate, chatCtrl.studentConversationMessages);
router.post('/chat/conversations/:id/messages', [
  param('id').isInt(),
  body('message_text').isString().notEmpty(),
], validate, chatCtrl.studentSendMessage);

router.get('/profile', ctrl.profile);
router.get('/profile/history', ctrl.academicHistory);
router.post('/profile/correction-request', [
  body('field_name').notEmpty(),
  body('requested_value').notEmpty(),
  body('reason').isLength({ min: 10 }),
], validate, ctrl.correctionRequestCreate);
router.get('/profile/correction-requests', ctrl.correctionRequestList);
router.post('/profile/change-password', [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 8 }),
], validate, ctrl.changePassword);

router.get('/achievements', ctrl.achievements);
router.get('/materials', ctrl.materials);
router.get('/materials/:id', [param('id').isInt()], validate, ctrl.materialDetail);
router.get('/history', ctrl.academicHistory);

module.exports = router;
