'use strict';

const sequelize          = require('../config/database');
const School             = require('./School');
const Session            = require('./Session');
const SessionWorkingDay  = require('./SessionWorkingDay');
const SessionHoliday     = require('./SessionHoliday');
const Class              = require('./Class');
const Section            = require('./Section');
const Subject            = require('./Subject');
const Exam               = require('./Exam');
const ExamSubject        = require('./ExamSubject');
const ExamResult         = require('./ExamResult');
const Student            = require('./Student');
const StudentBiometric   = require('./StudentBiometric');
const StudentProfile     = require('./StudentProfile');
const StudentSubject     = require('./StudentSubject');
const Enrollment         = require('./Enrollment');
const User               = require('./User');
const Teacher            = require('./Teacher');
const Attendance         = require('./Attendance');
const FeeStructure       = require('./FeeStructure');
const FeeInvoice         = require('./FeeInvoice');
const FeePayment         = require('./FeePayment');
const AuditLog           = require('./AuditLog');
const StudentResult      = require('./StudentResult');
const StudyMaterial      = require('./StudyMaterial');
const MaterialView       = require('./MaterialView');
const NoticePin          = require('./NoticePin');
const StudentAchievement = require('./StudentAchievement');
const StudentDocument    = require('./StudentDocument');
const GradingScale       = require('./GradingScale');
const MarkHistory        = require('./MarkHistory');
const StaffAttendance    = require('./StaffAttendance');
const Expense            = require('./Expense');
const SalaryStructure    = require('./SalaryStructure');
const Payroll            = require('./Payroll');
const StudentHealthProfile = require('./StudentHealthProfile');
const StudentVaccination   = require('./StudentVaccination');
const StudentHealthIncident = require('./StudentHealthIncident');
const Family               = require('./Family');
const InventoryItem        = require('./InventoryItem');
const InventoryTransaction = require('./InventoryTransaction');
const TransportRoute       = require('./TransportRoute');
const TransportStop        = require('./TransportStop');
const Feedback             = require('./Feedback');
const LibraryBook          = require('./LibraryBook');
const LibraryIssue         = require('./LibraryIssue');
const LibrarySetting       = require('./LibrarySetting');

// ── Associations ────────────────────────────────────────────────────────────

// Schools
School.hasMany(Session,  { foreignKey: 'school_id', as: 'sessions' });
Session.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(Class, { foreignKey: 'school_id', as: 'classes' });
Class.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(Student,  { foreignKey: 'school_id', as: 'students' });
Student.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(User, { foreignKey: 'school_id', as: 'users' });
User.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(Teacher, { foreignKey: 'school_id', as: 'teachers' });
Teacher.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(GradingScale, { foreignKey: 'school_id', as: 'gradingScales' });
GradingScale.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(StaffAttendance, { foreignKey: 'school_id', as: 'staffAttendanceRecords' });
StaffAttendance.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(Expense, { foreignKey: 'school_id', as: 'expenses' });
Expense.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

School.hasMany(SalaryStructure, { foreignKey: 'school_id', as: 'salaryStructures' });
SalaryStructure.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(Payroll, { foreignKey: 'school_id', as: 'payrolls' });
Payroll.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

School.hasMany(LibraryBook, { foreignKey: 'school_id', as: 'libraryBooks' });
LibraryBook.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(LibraryIssue, { foreignKey: 'school_id', as: 'libraryIssues' });
LibraryIssue.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasOne(LibrarySetting, { foreignKey: 'school_id', as: 'librarySetting' });
LibrarySetting.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

// Library
LibraryBook.hasMany(LibraryIssue, { foreignKey: 'book_id', as: 'issues' });
LibraryIssue.belongsTo(LibraryBook, { foreignKey: 'book_id', as: 'book' });

LibraryIssue.belongsTo(User, { foreignKey: 'issued_by', as: 'issuer' });
LibraryIssue.belongsTo(Student, { foreignKey: 'borrower_id', as: 'studentBorrower', constraints: false });
LibraryIssue.belongsTo(User, { foreignKey: 'borrower_id', as: 'staffBorrower', constraints: false });

Student.hasMany(LibraryIssue, { foreignKey: 'borrower_id', as: 'libraryIssues', constraints: false, scope: { borrower_type: 'student' } });
User.hasMany(LibraryIssue, { foreignKey: 'borrower_id', as: 'libraryIssues', constraints: false, scope: { borrower_type: 'staff' } });

Student.hasMany(StudentResult, { foreignKey: 'student_id', as: 'results' }); // Assuming there might be direct link, but results are usually via enrollments

Student.hasOne(StudentHealthProfile, { foreignKey: 'student_id', as: 'healthProfile' });
StudentHealthProfile.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Student.hasMany(StudentVaccination, { foreignKey: 'student_id', as: 'vaccinations' });
StudentVaccination.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Student.hasMany(StudentHealthIncident, { foreignKey: 'student_id', as: 'healthIncidents' });
StudentHealthIncident.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });
StudentHealthIncident.belongsTo(User, { foreignKey: 'reported_by', as: 'reporter' });

School.hasMany(Family, { foreignKey: 'school_id', as: 'families' });
Family.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

Family.hasMany(Student, { foreignKey: 'family_id', as: 'students' });
Student.belongsTo(Family, { foreignKey: 'family_id', as: 'family' });

Family.belongsTo(User, { foreignKey: 'user_id', as: 'parentUser' });
User.hasOne(Family, { foreignKey: 'user_id', as: 'family' });

School.hasMany(InventoryItem, { foreignKey: 'school_id', as: 'inventoryItems' });
InventoryItem.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

InventoryItem.hasMany(InventoryTransaction, { foreignKey: 'item_id', as: 'transactions' });
InventoryTransaction.belongsTo(InventoryItem, { foreignKey: 'item_id', as: 'item' });

InventoryTransaction.belongsTo(User, { foreignKey: 'performed_by', as: 'performer' });

School.hasMany(TransportRoute, { foreignKey: 'school_id', as: 'transportRoutes' });
TransportRoute.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

TransportRoute.hasMany(TransportStop, { foreignKey: 'route_id', as: 'stops' });
TransportStop.belongsTo(TransportRoute, { foreignKey: 'route_id', as: 'route' });

TransportStop.hasMany(Student, { foreignKey: 'transport_stop_id', as: 'students' });
Student.belongsTo(TransportStop, { foreignKey: 'transport_stop_id', as: 'transportStop' });

School.hasMany(Feedback, { foreignKey: 'school_id', as: 'feedbackRecords' });
Feedback.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

User.hasMany(Feedback, { foreignKey: 'user_id', as: 'submittedFeedback' });
Feedback.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

Feedback.belongsTo(User, { foreignKey: 'replied_by', as: 'replier' });

// Users
User.hasMany(StaffAttendance, { foreignKey: 'user_id', as: 'attendanceRecords' });
StaffAttendance.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

StaffAttendance.belongsTo(User, { foreignKey: 'created_by', as: 'marker' });

Expense.belongsTo(User, { foreignKey: 'submitted_by', as: 'submitter' });
Expense.belongsTo(User, { foreignKey: 'approved_by', as: 'approver' });

User.hasOne(SalaryStructure, { foreignKey: 'user_id', as: 'salaryStructure' });
SalaryStructure.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(Payroll, { foreignKey: 'user_id', as: 'payrolls' });
Payroll.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Sessions
Session.hasOne(SessionWorkingDay,  { foreignKey: 'session_id', as: 'workingDays' });
SessionWorkingDay.belongsTo(Session, { foreignKey: 'session_id', as: 'session' });

Session.hasMany(SessionHoliday,  { foreignKey: 'session_id', as: 'holidays' });
SessionHoliday.belongsTo(Session, { foreignKey: 'session_id', as: 'session' });

Session.hasMany(Enrollment, { foreignKey: 'session_id', as: 'enrollments' });
Enrollment.belongsTo(Session, { foreignKey: 'session_id', as: 'session' });

Session.hasMany(FeeStructure, { foreignKey: 'session_id', as: 'feeStructures' });
FeeStructure.belongsTo(Session, { foreignKey: 'session_id', as: 'session' });

// Classes & Sections
Class.hasMany(Section, { foreignKey: 'class_id', as: 'sections' });
Section.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });

Class.hasMany(Subject, { foreignKey: 'class_id', as: 'subjects' });
Subject.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });

Class.hasMany(Exam, { foreignKey: 'class_id', as: 'exams' });
Exam.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });

Class.hasMany(Enrollment, { foreignKey: 'class_id', as: 'enrollments' });
Enrollment.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });

Section.hasMany(Enrollment, { foreignKey: 'section_id', as: 'enrollments' });
Enrollment.belongsTo(Section, { foreignKey: 'section_id', as: 'section' });

Section.belongsTo(Teacher, { foreignKey: 'class_teacher_id', as: 'classTeacher' });
Teacher.hasMany(Section, { foreignKey: 'class_teacher_id', as: 'sectionsTaught' });

// Exams
Exam.hasMany(ExamSubject, { foreignKey: 'exam_id', as: 'examSubjects' });
ExamSubject.belongsTo(Exam, { foreignKey: 'exam_id', as: 'exam' });

Exam.hasMany(ExamResult, { foreignKey: 'exam_id', as: 'results' });
ExamResult.belongsTo(Exam, { foreignKey: 'exam_id', as: 'exam' });

Exam.hasMany(MarkHistory, { foreignKey: 'exam_id', as: 'markHistories' });
MarkHistory.belongsTo(Exam, { foreignKey: 'exam_id', as: 'exam' });

// Subjects
Subject.hasMany(ExamSubject, { foreignKey: 'subject_id', as: 'examSubjects' });
ExamSubject.belongsTo(Subject, { foreignKey: 'subject_id', as: 'subject' });

Subject.hasMany(ExamResult, { foreignKey: 'subject_id', as: 'examResults' });
ExamResult.belongsTo(Subject, { foreignKey: 'subject_id', as: 'subject' });

Subject.hasMany(MarkHistory, { foreignKey: 'subject_id', as: 'markHistories' });
MarkHistory.belongsTo(Subject, { foreignKey: 'subject_id', as: 'subject' });

// Students & Enrollments
Student.hasMany(Enrollment, { foreignKey: 'student_id', as: 'enrollments' });
Enrollment.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Student.hasOne(StudentProfile, { foreignKey: 'student_id', as: 'profile' });
StudentProfile.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Student.hasOne(StudentBiometric,  { foreignKey: 'student_id', as: 'biometrics' });
StudentBiometric.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Student.hasMany(StudentSubject, { foreignKey: 'student_id', as: 'studentSubjects' });
StudentSubject.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Enrollment.hasMany(Attendance, { foreignKey: 'enrollment_id', as: 'attendanceRecords' });
Attendance.belongsTo(Enrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });

Enrollment.hasMany(FeeInvoice, { foreignKey: 'enrollment_id', as: 'invoices' });
FeeInvoice.belongsTo(Enrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });

Enrollment.hasMany(ExamResult, { foreignKey: 'enrollment_id', as: 'examResults' });
ExamResult.belongsTo(Enrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });

Enrollment.hasMany(MarkHistory, { foreignKey: 'enrollment_id', as: 'markHistories' });
MarkHistory.belongsTo(Enrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });

// Fees
FeeStructure.hasMany(FeeInvoice, { foreignKey: 'fee_structure_id', as: 'invoices' });
FeeInvoice.belongsTo(FeeStructure, { foreignKey: 'fee_structure_id', as: 'feeStructure' });

FeeInvoice.hasMany(FeePayment, { foreignKey: 'invoice_id', as: 'payments' });
FeePayment.belongsTo(FeeInvoice, { foreignKey: 'invoice_id', as: 'invoice' });

FeePayment.belongsTo(User, { foreignKey: 'received_by', as: 'receivedBy' });

// Achievements & Documents
Student.hasMany(StudentAchievement, { foreignKey: 'student_id', as: 'achievements' });
StudentAchievement.belongsTo(Student, { foreignKey: 'student_id' });

Student.hasMany(StudentDocument, { foreignKey: 'student_id', as: 'documents' });
StudentDocument.belongsTo(Student, { foreignKey: 'student_id' });
StudentDocument.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

// Study Material
StudyMaterial.belongsTo(Teacher, { foreignKey: 'teacher_id', as: 'teacher' });
Teacher.hasMany(StudyMaterial, { foreignKey: 'teacher_id', as: 'studyMaterials' });

// AuditLog has no Sequelize association — queried by table_name + record_id directly

const db = {
  sequelize,
  Sequelize : sequelize.constructor,
  School,
  Session,
  SessionWorkingDay,
  SessionHoliday,
  Class,
  Section,
  Subject,
  Exam,
  ExamSubject,
  ExamResult,
  Student,
  StudentBiometric,
  StudentProfile,
  StudentSubject,
  Enrollment,
  User,
  Teacher,
  Attendance,
  FeeStructure,
  FeeInvoice,
  FeePayment,
  AuditLog,
  StudentResult,
  StudyMaterial,
  MaterialView,
  NoticePin,
  StudentAchievement,
  StudentDocument,
  GradingScale,
  MarkHistory,
  StaffAttendance,
  Expense,
  SalaryStructure,
  Payroll,
  StudentHealthProfile,
  StudentVaccination,
  StudentHealthIncident,
  Family,
  InventoryItem,
  InventoryTransaction,
  TransportRoute,
  TransportStop,
  Feedback,
  LibraryBook,
  LibraryIssue,
  LibrarySetting,
};

module.exports = db;
