'use strict';

const router = require('express').Router();
const { requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/adminTeacherControlController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = 'uploads/notices';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  }
});

router.use(requireRole('admin'));

router.get('/overview', ctrl.overview);
router.get('/teachers', ctrl.teachers);

router.get('/assignments', ctrl.assignments);
router.post('/assignments', ctrl.createAssignment);
router.patch('/assignments/:id', ctrl.updateAssignment);
router.delete('/assignments/:id', ctrl.deleteAssignment);

router.get('/timetable', ctrl.timetable);
router.post('/timetable', ctrl.createTimetableSlot);
router.patch('/timetable/:id', ctrl.updateTimetableSlot);
router.delete('/timetable/:id', ctrl.deleteTimetableSlot);

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

// Notices
router.get('/notices', ctrl.notices);
router.post('/notices', upload.single('attachment'), ctrl.createNotice);
router.patch('/notices/:id', upload.single('attachment'), ctrl.updateNotice);

// Leaves — specific routes MUST come before wildcard /:id routes (Bug #1 fix)
router.get('/leave/balances', ctrl.getLeaveBalances);
router.patch('/leave/balances/:teacher_id', ctrl.updateLeaveBalance);
router.patch('/leave/:id/revoke', ctrl.revokeLeave);

module.exports = router;
