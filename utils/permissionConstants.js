'use strict';

// All valid permission strings — single source of truth
const PERMISSIONS = {
  // Fees
  FEES_VIEW    : 'fees.view',
  FEES_COLLECT : 'fees.collect',
  FEES_EDIT    : 'fees.edit',
  FEES_WAIVE   : 'fees.waive',
  FEES_REPORT  : 'fees.report',
  FEES_REFUND  : 'fees.refund',

  // Students
  STUDENTS_VIEW     : 'students.view',
  STUDENTS_CREATE   : 'students.create',
  STUDENTS_EDIT     : 'students.edit',
  STUDENTS_DELETE   : 'students.delete',
  STUDENTS_PROMOTE  : 'students.promote',
  STUDENTS_TRANSFER : 'students.transfer',

  // Attendance
  ATTENDANCE_VIEW   : 'attendance.view',
  ATTENDANCE_MARK   : 'attendance.mark',
  ATTENDANCE_EDIT   : 'attendance.edit',
  ATTENDANCE_REPORT : 'attendance.report',

  // Results
  RESULTS_VIEW     : 'results.view',
  RESULTS_ENTER    : 'results.enter',
  RESULTS_EDIT     : 'results.edit',
  RESULTS_OVERRIDE : 'results.override',
  RESULTS_PUBLISH  : 'results.publish',

  // Classes
  CLASSES_VIEW   : 'classes.view',
  CLASSES_CREATE : 'classes.create',
  CLASSES_EDIT   : 'classes.edit',
  CLASSES_DELETE : 'classes.delete',

  // Reports
  REPORTS_FEES       : 'reports.fees',
  REPORTS_ATTENDANCE : 'reports.attendance',
  REPORTS_RESULTS    : 'reports.results',
  REPORTS_EXPORT     : 'reports.export',

  // Users
  USERS_VIEW        : 'users.view',
  USERS_CREATE      : 'users.create',
  USERS_EDIT        : 'users.edit',
  USERS_DELETE      : 'users.delete',
  USERS_PERMISSIONS : 'users.permissions',

  // Audit
  AUDIT_VIEW   : 'audit.view',
  AUDIT_EXPORT : 'audit.export',

  // Notices
  NOTICES_VIEW        : 'notices.view',
  NOTICES_POST        : 'notices.post',
  NOTICES_ALL_CLASSES : 'notices.all_classes',
  NOTICES_EDIT        : 'notices.edit',
  NOTICES_DELETE      : 'notices.delete',
};

// Roles that have full access regardless of permission table
const ADMIN_ROLES = ['admin'];

const DEFAULT_ROLE_PERMISSIONS = {
  teacher: [
    PERMISSIONS.STUDENTS_VIEW,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_MARK,
    PERMISSIONS.RESULTS_VIEW,
    PERMISSIONS.RESULTS_ENTER,
    PERMISSIONS.NOTICES_VIEW,
    PERMISSIONS.NOTICES_POST,
    PERMISSIONS.CLASSES_VIEW,
  ],
  accountant: [
    PERMISSIONS.FEES_VIEW,
    PERMISSIONS.FEES_COLLECT,
    PERMISSIONS.FEES_EDIT,
    PERMISSIONS.FEES_REPORT,
    PERMISSIONS.REPORTS_EXPORT,
  ],
  student: [],
};

module.exports = { PERMISSIONS, ADMIN_ROLES, DEFAULT_ROLE_PERMISSIONS };
