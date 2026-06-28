'use strict';

const sequelize          = require('../config/database');
const AcademicEvent      = require('./AcademicEvent');
const Attendance         = require('./Attendance');
const AuditLog           = require('./AuditLog');
const Certificate        = require('./Certificate');
const Class              = require('./Class');
const Enrollment         = require('./Enrollment');
const Exam               = require('./Exam');
const ExamResult         = require('./ExamResult');
const ExamSubject        = require('./ExamSubject');
const Expense            = require('./Expense');
const Family             = require('./Family');
const Feedback           = require('./Feedback');
const FeeInvoice         = require('./FeeInvoice');
const FeePayment         = require('./FeePayment');
const FeeStructure       = require('./FeeStructure');
const GradingScale       = require('./GradingScale');
const InventoryItem      = require('./InventoryItem');
const InventoryTransaction = require('./InventoryTransaction');
const LibraryBook        = require('./LibraryBook');
const LibraryIssue       = require('./LibraryIssue');
const LibraryReservation = require('./LibraryReservation');
const LibrarySetting      = require('./LibrarySetting');
const MarkHistory        = require('./MarkHistory');
const MaterialView       = require('./MaterialView');
const Notice             = require('./Notice');
const NoticePin          = require('./NoticePin');
const Payroll            = require('./Payroll');
const PushToken          = require('./PushToken');
const SalaryStructure    = require('./SalaryStructure');
const School             = require('./School');
const Section            = require('./Section');
const Session            = require('./Session');
const SessionHoliday     = require('./SessionHoliday');
const SessionWorkingDay  = require('./SessionWorkingDay');
const StaffAttendance    = require('./StaffAttendance');
const Student            = require('./Student');
const StudentAchievement = require('./StudentAchievement');
const StudentBiometric   = require('./StudentBiometric');
const StudentDocument    = require('./StudentDocument');
const StudentHealthIncident = require('./StudentHealthIncident');
const StudentHealthProfile = require('./StudentHealthProfile');
const StudentProfile     = require('./StudentProfile');
const StudentPreviousAcademicRecord = require('./StudentPreviousAcademicRecord');
const StudentResult      = require('./StudentResult');
const StudentSubject     = require('./StudentSubject');
const StudentVaccination = require('./StudentVaccination');
const StudyMaterial      = require('./StudyMaterial');
const Subject            = require('./Subject');
const Teacher            = require('./Teacher');
const TransportRoute     = require('./TransportRoute');
const TransportStop      = require('./TransportStop');
const User               = require('./User');
const AlumniProfile      = require('./AlumniProfile');
const AlumniEvent        = require('./AlumniEvent');

// ── Associations ─────────────────────────────────────────────────────────────

// School
School.hasMany(Session, { foreignKey: 'school_id', as: 'sessions' });
Session.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

School.hasMany(User, { foreignKey: 'school_id', as: 'users' });
User.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

School.hasMany(Teacher, { foreignKey: 'school_id', as: 'teachers' });
Teacher.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

School.hasMany(Student, { foreignKey: 'school_id', as: 'students' });
Student.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

// Session
Session.hasOne(SessionWorkingDay, { foreignKey: 'session_id', as: 'working_days' });
SessionWorkingDay.belongsTo(Session, { foreignKey: 'session_id' });

Session.hasMany(SessionHoliday, { foreignKey: 'session_id', as: 'holidays' });
SessionHoliday.belongsTo(Session, { foreignKey: 'session_id' });

// Academic Events
School.hasMany(AcademicEvent, { foreignKey: 'school_id', as: 'academicEvents' });
AcademicEvent.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

Session.hasMany(AcademicEvent, { foreignKey: 'session_id', as: 'academicEvents' });
AcademicEvent.belongsTo(Session, { foreignKey: 'session_id', as: 'session' });

AcademicEvent.belongsTo(Class, { foreignKey: 'target_class_id', as: 'targetClass' });
AcademicEvent.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
AcademicEvent.belongsTo(User, { foreignKey: 'updated_by', as: 'updater' });

// Class & Section
Class.hasMany(Section, { foreignKey: 'class_id', as: 'sections' });
Section.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });

Section.belongsTo(Teacher, { foreignKey: 'class_teacher_id', as: 'classTeacher' });
Teacher.hasMany(Section, { foreignKey: 'class_teacher_id', as: 'assignedSections' });

// Subject
Subject.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });
Class.hasMany(Subject, { foreignKey: 'class_id', as: 'subjects' });

// Student & Enrollment
Student.hasMany(Enrollment, { foreignKey: 'student_id', as: 'enrollments' });
Enrollment.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Enrollment.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });
Class.hasMany(Enrollment, { foreignKey: 'class_id', as: 'enrollments' });

Enrollment.belongsTo(Section, { foreignKey: 'section_id', as: 'section' });
Section.hasMany(Enrollment, { foreignKey: 'section_id', as: 'enrollments' });

Enrollment.belongsTo(Session, { foreignKey: 'session_id', as: 'session' });
Session.hasMany(Enrollment, { foreignKey: 'session_id', as: 'enrollments' });

Student.hasMany(StudentProfile, { foreignKey: 'student_id', as: 'profiles' });
StudentProfile.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Student.hasMany(StudentPreviousAcademicRecord, { foreignKey: 'student_id', as: 'previous_academic_records' });
StudentPreviousAcademicRecord.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });

Enrollment.hasMany(Attendance, { foreignKey: 'enrollment_id', as: 'attendance' });
Attendance.belongsTo(Enrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });

// Exams
Class.hasMany(Exam, { foreignKey: 'class_id', as: 'exams' });
Exam.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });

Exam.hasMany(ExamResult, { foreignKey: 'exam_id', as: 'results' });
ExamResult.belongsTo(Exam, { foreignKey: 'exam_id', as: 'exam' });

Enrollment.hasMany(ExamResult, { foreignKey: 'enrollment_id', as: 'exam_results' });
ExamResult.belongsTo(Enrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });

Enrollment.hasOne(StudentResult, { foreignKey: 'enrollment_id', as: 'final_result' });
StudentResult.belongsTo(Enrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });

// Notice
Notice.hasMany(NoticePin, { foreignKey: 'notice_id', as: 'pins' });
NoticePin.belongsTo(Notice, { foreignKey: 'notice_id' });

// Fees
Enrollment.hasMany(FeeInvoice, { foreignKey: 'enrollment_id', as: 'invoices' });
FeeInvoice.belongsTo(Enrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });

FeeInvoice.hasMany(FeePayment, { foreignKey: 'invoice_id', as: 'payments' });
FeePayment.belongsTo(FeeInvoice, { foreignKey: 'invoice_id', as: 'invoice' });

// Payroll
Teacher.hasOne(SalaryStructure, { foreignKey: 'teacher_id', as: 'salary_structure' });
SalaryStructure.belongsTo(Teacher, { foreignKey: 'teacher_id' });

Teacher.hasMany(Payroll, { foreignKey: 'teacher_id', as: 'payrolls' });
Payroll.belongsTo(Teacher, { foreignKey: 'teacher_id' });

// Library
LibraryBook.hasMany(LibraryIssue, { foreignKey: 'book_id', as: 'issues' });
LibraryIssue.belongsTo(LibraryBook, { foreignKey: 'book_id', as: 'book' });

LibraryBook.hasMany(LibraryReservation, { foreignKey: 'book_id', as: 'reservations' });
LibraryReservation.belongsTo(LibraryBook, { foreignKey: 'book_id', as: 'book' });
LibraryReservation.belongsTo(Student, { foreignKey: 'borrower_id', as: 'studentBorrower', constraints: false });
LibraryReservation.belongsTo(User, { foreignKey: 'borrower_id', as: 'staffBorrower', constraints: false });
LibraryReservation.belongsTo(Teacher, { foreignKey: 'borrower_id', as: 'teacherBorrower', constraints: false });

LibraryIssue.belongsTo(User, { foreignKey: 'issued_by', as: 'issuer' });

// Certificates
Certificate.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });
Student.hasMany(Certificate, { foreignKey: 'student_id', as: 'certificates' });

Certificate.belongsTo(Teacher, { foreignKey: 'teacher_id', as: 'teacher' });
Teacher.hasMany(Certificate, { foreignKey: 'teacher_id', as: 'certificates' });

Certificate.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(Certificate, { foreignKey: 'school_id', as: 'certificates' });

Certificate.belongsTo(User, { foreignKey: 'issued_by', as: 'issuer' });

Certificate.belongsTo(User, { foreignKey: 'issued_by', as: 'issuerUser', constraints: false });
Certificate.belongsTo(Teacher, { foreignKey: 'issued_by', as: 'issuerTeacher', constraints: false });

// Family
Student.belongsTo(Family, { foreignKey: 'family_id', as: 'family' });
Family.hasMany(Student, { foreignKey: 'family_id', as: 'students' });

// Alumni
Student.hasOne(AlumniProfile, { foreignKey: 'student_id', as: 'alumniProfile' });
AlumniProfile.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });
AlumniProfile.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
AlumniEvent.belongsTo(School, { foreignKey: 'school_id', as: 'school' });

// Inventory
InventoryItem.hasMany(InventoryTransaction, { foreignKey: 'item_id', as: 'transactions' });
InventoryTransaction.belongsTo(InventoryItem, { foreignKey: 'item_id', as: 'item' });
InventoryItem.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(InventoryItem, { foreignKey: 'school_id', as: 'inventory_items' });

StaffAttendance.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(StaffAttendance, { foreignKey: 'user_id', as: 'staff_attendance_records' });

StaffAttendance.belongsTo(Teacher, { foreignKey: 'teacher_id', as: 'teacher' });
Teacher.hasMany(StaffAttendance, { foreignKey: 'teacher_id', as: 'attendance_records' });

StaffAttendance.belongsTo(School, { foreignKey: 'school_id', as: 'school' });
School.hasMany(StaffAttendance, { foreignKey: 'school_id', as: 'staff_attendance' });

const db = {
  sequelize,
  AcademicEvent,
  Attendance,
  AuditLog,
  Certificate,
  Class,
  Enrollment,
  Exam,
  ExamResult,
  ExamSubject,
  Expense,
  Family,
  Feedback,
  FeeInvoice,
  FeePayment,
  FeeStructure,
  GradingScale,
  InventoryItem,
  InventoryTransaction,
  LibraryBook,
  LibraryIssue,
  LibraryReservation,
  LibrarySetting,
  MarkHistory,
  MaterialView,
  Notice,
  NoticePin,
  Payroll,
  PushToken,
  SalaryStructure,
  School,
  Section,
  Session,
  SessionHoliday,
  SessionWorkingDay,
  StaffAttendance,
  Student,
  StudentAchievement,
  StudentBiometric,
  StudentDocument,
  StudentHealthIncident,
  StudentHealthProfile,
  StudentProfile,
  StudentPreviousAcademicRecord,
  StudentResult,
  StudentSubject,
  StudentVaccination,
  StudyMaterial,
  Subject,
  Teacher,
  TransportRoute,
  TransportStop,
  User,
  AlumniProfile,
  AlumniEvent,
};

module.exports = db;
