'use strict';

const db = require('../config/database');
const attendanceCtrl = require('../controllers/attendanceController');
const staffRouter = require('../routes/staffAttendance');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    fail(msg, errors = [], code = 400) {
      this.statusCode = code;
      this.body = { success: false, message: msg, errors };
      return this;
    },
    ok(data, msg = '') {
      this.statusCode = 200;
      this.body = { success: true, data, message: msg };
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    pipe(dest) {
      return dest;
    },
    end() {}
  };
}

function mockNext(err) {
  if (err) throw err;
}

async function runTests() {
  console.log('--- STARTING SECURITY VERIFICATION TESTS ---');
  let testsFailed = 0;

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Route Protection for Staff Attendance stats route
  // ───────────────────────────────────────────────────────────────────────────
  try {
    const statsRoute = staffRouter.stack.find(layer => layer.route && layer.route.path === '/stats/:staff_id');
    if (!statsRoute) {
      throw new Error('Staff stats route not found in router.');
    }
    
    // Check if requireRole middleware exists in stack
    // requireRole returns a function. We can check the route stack layers.
    const hasRequireRole = statsRoute.route.stack.some(layer => {
      return layer.handle.name === 'middleware' || (layer.handle.toString().includes('requireRole') || layer.handle.toString().includes('admin'));
    });

    if (hasRequireRole) {
      console.log('✅ TEST 1 PASSED: staff-attendance stats route has permission middleware.');
    } else {
      console.log('❌ TEST 1 FAILED: staff-attendance stats route does not have requireRole middleware.');
      testsFailed++;
    }
  } catch (err) {
    console.log('❌ TEST 1 FAILED with error:', err.message);
    testsFailed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Cross-school session_id/class_id/section_id on report/download (IDOR)
  // ───────────────────────────────────────────────────────────────────────────
  let tempSchoolId = 9999;
  let tempSessionId = 9999;
  try {
    // 2a. Insert temporary school and session
    await db.query(`INSERT INTO schools (id, name, created_at, updated_at) VALUES (${tempSchoolId}, 'Malicious School', NOW(), NOW())`);
    await db.query(`INSERT INTO sessions (id, school_id, name, start_date, end_date, status, is_current, is_locked, created_at, updated_at) VALUES (${tempSessionId}, ${tempSchoolId}, 'Malicious Session', '2026-01-01', '2026-12-31', 'active', true, false, NOW(), NOW())`);

    // 2b. Attempt to download summary report for the temporary school session using Greenwood Academy admin context (school_id = 1)
    const req = {
      user: { id: 1, school_id: 1, role: 'admin' },
      query: {
        session_id: tempSessionId,
        class_id: 1,
        section_id: 1,
        from_date: '2026-07-01',
        to_date: '2026-07-08'
      }
    };
    const res = mockRes();

    await attendanceCtrl.downloadSummaryReportPdf(req, res, mockNext);

    if (res.statusCode === 404) {
      console.log('✅ TEST 2 PASSED: cross-school report download request blocked with 404.');
    } else {
      console.log(`❌ TEST 2 FAILED: expected 404 but got status ${res.statusCode}.`);
      testsFailed++;
    }
  } catch (err) {
    if (err.status === 404 || err.statusCode === 404) {
      console.log('✅ TEST 2 PASSED: cross-school report download request blocked (threw 404).');
    } else {
      console.log('❌ TEST 2 FAILED with error:', err.message);
      testsFailed++;
    }
  } finally {
    // Clean up temporary session/school
    await db.query(`DELETE FROM sessions WHERE id = ${tempSessionId}`);
    await db.query(`DELETE FROM schools WHERE id = ${tempSchoolId}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Teacher Assignment scoping checks
  // ───────────────────────────────────────────────────────────────────────────
  let tempAssignmentId = 9999;
  try {
    // 3a. Verify teacher 1 has no assignments seeded
    const reqNoAccess = {
      user: { id: 1, school_id: 1, role: 'teacher' },
      query: {
        session_id: 1,
        class_id: 1,
        section_id: 1,
        date: '2026-07-08'
      }
    };
    const resNoAccess = mockRes();

    let blocked = false;
    try {
      await attendanceCtrl.getClassAttendance(reqNoAccess, resNoAccess, mockNext);
    } catch (err) {
      if (err.status === 403) {
        blocked = true;
      } else {
        throw err;
      }
    }

    if (blocked || resNoAccess.statusCode === 403) {
      console.log('✅ TEST 3a PASSED: Teacher without assignment was blocked with 403.');
    } else {
      console.log(`❌ TEST 3a FAILED: expected 403 for unassigned class, but got status ${resNoAccess.statusCode}`);
      testsFailed++;
    }

    // 3b. Insert temporary teacher assignment
    await db.query(`DELETE FROM teacher_assignments WHERE session_id = 1 AND class_id = 1 AND section_id = 1 AND is_class_teacher = true`);
    await db.query(`
      INSERT INTO teacher_assignments (id, teacher_id, session_id, class_id, section_id, is_class_teacher, is_active, created_at, updated_at)
      VALUES (${tempAssignmentId}, 1, 1, 1, 1, true, true, NOW(), NOW())
    `);

    // 3c. Try again now that teacher is assigned
    const reqAccess = {
      user: { id: 1, school_id: 1, role: 'teacher' },
      query: {
        session_id: 1,
        class_id: 1,
        section_id: 1,
        date: '2026-07-08'
      }
    };
    const resAccess = mockRes();

    await attendanceCtrl.getClassAttendance(reqAccess, resAccess, mockNext);

    if (resAccess.statusCode === 200) {
      console.log('✅ TEST 3b PASSED: Assigned teacher was granted access successfully.');
    } else {
      console.log(`❌ TEST 3b FAILED: assigned teacher was blocked, got status ${resAccess.statusCode}`);
      testsFailed++;
    }

  } catch (err) {
    console.log('❌ TEST 3 FAILED with error:', err);
    testsFailed++;
  } finally {
    // Clean up temporary assignment
    await db.query(`DELETE FROM teacher_assignments WHERE id = ${tempAssignmentId}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: general /api/sections route retrieves school sections without class id
  // ───────────────────────────────────────────────────────────────────────────
  try {
    const classCtrl = require('../controllers/classController');
    const reqSections = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: {} // no id param
    };
    const resSections = mockRes();
    await classCtrl.getSections(reqSections, resSections, mockNext);

    if (resSections.statusCode === 200 && Array.isArray(resSections.body.data)) {
      console.log('✅ TEST 4 PASSED: /api/sections general route returns school sections successfully.');
    } else {
      console.log(`❌ TEST 4 FAILED: expected 200 with sections array, got status ${resSections.statusCode}`);
      testsFailed++;
    }
  } catch (err) {
    console.log('❌ TEST 4 FAILED with error:', err.message);
    testsFailed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5 & 6: createSection & updateSection validate class_teacher_id from other school
  // ───────────────────────────────────────────────────────────────────────────
  let maliciousTeacherId = 8888;
  let maliciousSchoolId = 8888;
  try {
    const classCtrl = require('../controllers/classController');
    // Setup another school and a teacher in that school
    await db.query(`INSERT INTO schools (id, name, created_at, updated_at) VALUES (${maliciousSchoolId}, 'Malicious School', NOW(), NOW())`);
    await db.query(`
      INSERT INTO teachers (id, school_id, first_name, last_name, email, employee_id, password_hash, is_active, is_deleted, created_at, updated_at)
      VALUES (${maliciousTeacherId}, ${maliciousSchoolId}, 'Malicious', 'Teacher', 'malicious@school.com', 'EMP-8888', 'hash', true, false, NOW(), NOW())
    `);

    // Try to create a section in Greenwood Academy (school 1) with teacher from school 8888
    const reqCreate = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { id: 1 }, // class_id = 1
      body: { name: 'Z', capacity: 30, class_teacher_id: maliciousTeacherId }
    };
    const resCreate = mockRes();
    await classCtrl.createSection(reqCreate, resCreate, mockNext);

    if (resCreate.statusCode === 422) {
      console.log('✅ TEST 5 PASSED: createSection blocks cross-school teacher assignment with 422.');
    } else {
      console.log(`❌ TEST 5 FAILED: expected 422 for cross-school teacher, got status ${resCreate.statusCode}`);
      testsFailed++;
    }

    // Try to update a section in Greenwood Academy with teacher from school 8888
    const reqUpdate = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { id: 1, sectionId: 1 },
      body: { class_teacher_id: maliciousTeacherId }
    };
    const resUpdate = mockRes();
    await classCtrl.updateSection(reqUpdate, resUpdate, mockNext);

    if (resUpdate.statusCode === 422) {
      console.log('✅ TEST 6 PASSED: updateSection blocks cross-school teacher assignment with 422.');
    } else {
      console.log(`❌ TEST 6 FAILED: expected 422 for cross-school teacher, got status ${resUpdate.statusCode}`);
      testsFailed++;
    }
  } catch (err) {
    console.log('❌ TEST 5/6 FAILED with error:', err.message);
    testsFailed++;
  } finally {
    // Clean up
    await db.query(`DELETE FROM teachers WHERE id = ${maliciousTeacherId}`);
    await db.query(`DELETE FROM schools WHERE id = ${maliciousSchoolId}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 7-10: Student Subjects IDOR safety checks
  // ───────────────────────────────────────────────────────────────────────────
  let altSchoolId = 7777;
  let altStudentId = 7777;
  try {
    const studentSubCtrl = require('../controllers/studentSubjectController');
    // Setup another school and a student in that school
    await db.query(`INSERT INTO schools (id, name, created_at, updated_at) VALUES (${altSchoolId}, 'Alternate School', NOW(), NOW())`);
    await db.query(`
      INSERT INTO students (id, school_id, admission_no, first_name, last_name, gender, date_of_birth, is_active, is_deleted, created_at, updated_at)
      VALUES (${altStudentId}, ${altSchoolId}, 'ADM-7777', 'Alt', 'Student', 'male', '2015-01-01', true, false, NOW(), NOW())
    `);

    // TEST 7: assignSubjects
    const reqAssign = {
      user: { id: 1, school_id: 1, role: 'admin' },
      body: { student_id: altStudentId, session_id: 1, subject_ids: [1] }
    };
    const resAssign = mockRes();
    await studentSubCtrl.assignSubjects(reqAssign, resAssign, mockNext);

    if (resAssign.statusCode === 404) {
      console.log('✅ TEST 7 PASSED: assignSubjects blocks cross-school student IDOR with 404.');
    } else {
      console.log(`❌ TEST 7 FAILED: expected 404, got status ${resAssign.statusCode}`);
      testsFailed++;
    }

    // TEST 8: getStudentSubjects
    const reqGet = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { student_id: altStudentId, session_id: 1 }
    };
    const resGet = mockRes();
    await studentSubCtrl.getStudentSubjects(reqGet, resGet, mockNext);

    if (resGet.statusCode === 404) {
      console.log('✅ TEST 8 PASSED: getStudentSubjects blocks cross-school student IDOR with 404.');
    } else {
      console.log(`❌ TEST 8 FAILED: expected 404, got status ${resGet.statusCode}`);
      testsFailed++;
    }

    // TEST 9: removeSubject
    const reqRemove = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { student_id: altStudentId, session_id: 1, subject_id: 1 }
    };
    const resRemove = mockRes();
    await studentSubCtrl.removeSubject(reqRemove, resRemove, mockNext);

    if (resRemove.statusCode === 404) {
      console.log('✅ TEST 9 PASSED: removeSubject blocks cross-school student IDOR with 404.');
    } else {
      console.log(`❌ TEST 9 FAILED: expected 404, got status ${resRemove.statusCode}`);
      testsFailed++;
    }

    // TEST 10: autoAssignCoreSubjects
    const reqAuto = {
      user: { id: 1, school_id: 1, role: 'admin' },
      body: { student_id: altStudentId, session_id: 1 }
    };
    const resAuto = mockRes();
    await studentSubCtrl.autoAssignCoreSubjects(reqAuto, resAuto, mockNext);

    if (resAuto.statusCode === 404) {
      console.log('✅ TEST 10 PASSED: autoAssignCoreSubjects blocks cross-school student IDOR with 404.');
    } else {
      console.log(`❌ TEST 10 FAILED: expected 404, got status ${resAuto.statusCode}`);
      testsFailed++;
    }

  } catch (err) {
    console.log('❌ TEST 7-10 FAILED with error:', err.message);
    testsFailed++;
  } finally {
    // Clean up
    await db.query(`DELETE FROM students WHERE id = ${altStudentId}`);
    await db.query(`DELETE FROM schools WHERE id = ${altSchoolId}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 11-12: Certificate IDOR safety checks
  // ───────────────────────────────────────────────────────────────────────────
  let certSchoolId = 6666;
  let certId = '00000000-0000-0000-0000-000000006666';
  try {
    const certCtrl = require('../controllers/certificateController');
    const { Certificate } = require('../models');
    // Setup another school and a certificate in that school
    await db.query(`INSERT INTO schools (id, name, created_at, updated_at) VALUES (${certSchoolId}, 'Cert School', NOW(), NOW())`);
    await Certificate.create({
      id: certId,
      certificate_no: 'TC-2026-6666',
      school_id: certSchoolId,
      type: 'transfer',
      recipient_type: 'student',
      status: 'active',
      issued_by: 1,
      issued_date: new Date()
    });

    // TEST 11: getCertificateById
    const reqGetCert = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { id: certId }
    };
    const resGetCert = mockRes();
    await certCtrl.getCertificateById(reqGetCert, resGetCert, mockNext);

    if (resGetCert.statusCode === 404) {
      console.log('✅ TEST 11 PASSED: getCertificateById blocks cross-school certificate IDOR with 404.');
    } else {
      console.log(`❌ TEST 11 FAILED: expected 404, got status ${resGetCert.statusCode}`);
      testsFailed++;
    }

    // TEST 12: revokeCertificate
    const reqRevokeCert = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { id: certId }
    };
    const resRevokeCert = mockRes();
    await certCtrl.revokeCertificate(reqRevokeCert, resRevokeCert, mockNext);

    if (resRevokeCert.statusCode === 404) {
      console.log('✅ TEST 12 PASSED: revokeCertificate blocks cross-school certificate IDOR with 404.');
    } else {
      console.log(`❌ TEST 12 FAILED: expected 404, got status ${resRevokeCert.statusCode}`);
      testsFailed++;
    }

  } catch (err) {
    console.log('❌ TEST 11-12 FAILED with error:', err.message, err.errors || err);
    testsFailed++;
  } finally {
    // Clean up
    await db.query(`DELETE FROM certificates WHERE id = '${certId}'`);
    await db.query(`DELETE FROM schools WHERE id = ${certSchoolId}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 13-19: Exams, Results, and Fees IDOR safety checks
  // ───────────────────────────────────────────────────────────────────────────
  let targetSchoolId = 8888;
  let targetSessionId = 8888;
  let targetClassId = 8888;
  let targetExamId = 8888;
  let targetEnrollmentId = 8888;
  let targetInvoiceId = 8888;
  let targetStudentId = 8888;

  try {
    const examCtrl = require('../controllers/examController');
    const resultCtrl = require('../controllers/resultController');
    const feeCtrl = require('../controllers/feeController');

    // Set up alternate school records
    await db.query(`INSERT INTO schools (id, name, created_at, updated_at) VALUES (${targetSchoolId}, 'Alternate School', NOW(), NOW())`);
    await db.query(`INSERT INTO sessions (id, school_id, name, start_date, end_date, created_at, updated_at) VALUES (${targetSessionId}, ${targetSchoolId}, 'Session 8888', '2026-01-01', '2026-12-31', NOW(), NOW())`);
    await db.query(`INSERT INTO classes (id, school_id, name, stream, order_number, created_at, updated_at) VALUES (${targetClassId}, ${targetSchoolId}, 'Class 8888', 'science', 1, NOW(), NOW())`);
    await db.query(`INSERT INTO sections (id, class_id, name, capacity, is_active, created_at, updated_at) VALUES (8888, ${targetClassId}, 'A', 30, true, NOW(), NOW())`);
    await db.query(`INSERT INTO exams (id, session_id, class_id, name, exam_type, start_date, end_date, total_marks, passing_marks, weightage, created_at, updated_at) VALUES (${targetExamId}, ${targetSessionId}, ${targetClassId}, 'Exam 8888', 'term', '2026-06-01', '2026-06-10', 100, 40, 100, NOW(), NOW())`);
    await db.query(`INSERT INTO students (id, school_id, admission_no, first_name, last_name, gender, date_of_birth, is_active, is_deleted, created_at, updated_at) VALUES (${targetStudentId}, ${targetSchoolId}, 'ADM-8888', 'Alt', 'Student', 'male', '2015-01-01', true, false, NOW(), NOW())`);
    await db.query(`INSERT INTO enrollments (id, session_id, student_id, class_id, section_id, joined_date, joining_type, status, created_at, updated_at) VALUES (${targetEnrollmentId}, ${targetSessionId}, ${targetStudentId}, ${targetClassId}, 8888, '2026-06-01', 'fresh', 'active', NOW(), NOW())`);
    await db.query(`INSERT INTO fee_structures (id, session_id, class_id, name, amount, frequency, due_day, created_at, updated_at) VALUES (8888, ${targetSessionId}, ${targetClassId}, 'Fee 8888', 1000, 'one_time', 15, NOW(), NOW())`);
    await db.query(`INSERT INTO fee_invoices (id, enrollment_id, fee_structure_id, amount_due, amount_paid, status, due_date, created_at, updated_at) VALUES (${targetInvoiceId}, ${targetEnrollmentId}, 8888, 1000, 0, 'pending', '2026-06-15', NOW(), NOW())`);

    // TEST 13: getSubjects (Exams)
    const reqGetSubjects = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { id: targetExamId }
    };
    const resGetSubjects = mockRes();
    await examCtrl.getSubjects(reqGetSubjects, resGetSubjects, mockNext);

    if (resGetSubjects.statusCode === 404) {
      console.log('✅ TEST 13 PASSED: getSubjects blocks cross-school exam IDOR with 404.');
    } else {
      console.log(`❌ TEST 13 FAILED: expected 404, got status ${resGetSubjects.statusCode}`);
      testsFailed++;
    }

    // TEST 14: getTemplate (Exams)
    const reqGetTemplate = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { id: targetExamId, subjectId: 1 }
    };
    const resGetTemplate = mockRes();
    await examCtrl.getTemplate(reqGetTemplate, resGetTemplate, mockNext);

    if (resGetTemplate.statusCode === 404) {
      console.log('✅ TEST 14 PASSED: getTemplate blocks cross-school exam IDOR with 404.');
    } else {
      console.log(`❌ TEST 14 FAILED: expected 404, got status ${resGetTemplate.statusCode}`);
      testsFailed++;
    }

    // TEST 15: getExamMarks (Results)
    const reqGetExamMarks = {
      user: { id: 1, school_id: 1, role: 'admin' },
      query: { exam_id: targetExamId, class_id: targetClassId, section_id: 1 }
    };
    const resGetExamMarks = mockRes();
    await resultCtrl.getExamMarks(reqGetExamMarks, resGetExamMarks, mockNext);

    if (resGetExamMarks.statusCode === 404) {
      console.log('✅ TEST 15 PASSED: getExamMarks blocks cross-school exam IDOR with 404.');
    } else {
      console.log(`❌ TEST 15 FAILED: expected 404, got status ${resGetExamMarks.statusCode}`);
      testsFailed++;
    }

    // TEST 16: getStudentFees (Fees)
    const reqGetStudentFees = {
      user: { id: 1, school_id: 1, role: 'admin' },
      params: { enrollment_id: targetEnrollmentId }
    };
    const resGetStudentFees = mockRes();
    await feeCtrl.getStudentFees(reqGetStudentFees, resGetStudentFees, mockNext);

    if (resGetStudentFees.statusCode === 404) {
      console.log('✅ TEST 16 PASSED: getStudentFees blocks cross-school enrollment IDOR with 404.');
    } else {
      console.log(`❌ TEST 16 FAILED: expected 404, got status ${resGetStudentFees.statusCode}`);
      testsFailed++;
    }

    // TEST 17: recordPayment (Fees)
    const reqRecordPayment = {
      user: { id: 1, school_id: 1, role: 'admin' },
      body: { invoice_id: targetInvoiceId, amount: 1000, payment_date: '2026-06-15', payment_mode: 'cash' }
    };
    const resRecordPayment = mockRes();
    await feeCtrl.recordPayment(reqRecordPayment, resRecordPayment, mockNext);

    if (resRecordPayment.statusCode === 404) {
      console.log('✅ TEST 17 PASSED: recordPayment blocks cross-school invoice IDOR with 404.');
    } else {
      console.log(`❌ TEST 17 FAILED: expected 404, got status ${resRecordPayment.statusCode}`);
      testsFailed++;
    }

    // TEST 18: carryForward (Fees)
    const reqCarryForward = {
      user: { id: 1, school_id: 1, role: 'admin' },
      body: { student_id: targetStudentId, from_session_id: 1, to_session_id: 2 }
    };
    const resCarryForward = mockRes();
    await feeCtrl.carryForward(reqCarryForward, resCarryForward, mockNext);

    if (resCarryForward.statusCode === 404) {
      console.log('✅ TEST 18 PASSED: carryForward blocks cross-school student IDOR with 404.');
    } else {
      console.log(`❌ TEST 18 FAILED: expected 404, got status ${resCarryForward.statusCode}`);
      testsFailed++;
    }

    // TEST 19: generate (Fees)
    const reqGenerate = {
      user: { id: 1, school_id: 1, role: 'admin' },
      body: { session_id: targetSessionId }
    };
    const resGenerate = mockRes();
    await feeCtrl.generate(reqGenerate, resGenerate, mockNext);

    if (resGenerate.statusCode === 404) {
      console.log('✅ TEST 19 PASSED: generate blocks cross-school session IDOR with 404.');
    } else {
      console.log(`❌ TEST 19 FAILED: expected 404, got status ${resGenerate.statusCode}`);
      testsFailed++;
    }

  } catch (err) {
    console.log('❌ TEST 13-19 FAILED with error:', err.message);
    testsFailed++;
  } finally {
    // Clean up
    await db.query(`DELETE FROM fee_invoices WHERE id = ${targetInvoiceId}`);
    await db.query(`DELETE FROM fee_structures WHERE id = 8888`);
    await db.query(`DELETE FROM enrollments WHERE id = ${targetEnrollmentId}`);
    await db.query(`DELETE FROM students WHERE id = ${targetStudentId}`);
    await db.query(`DELETE FROM exams WHERE id = ${targetExamId}`);
    await db.query(`DELETE FROM sections WHERE id = 8888`);
    await db.query(`DELETE FROM classes WHERE id = ${targetClassId}`);
    await db.query(`DELETE FROM sessions WHERE id = ${targetSessionId}`);
    await db.query(`DELETE FROM schools WHERE id = ${targetSchoolId}`);
  }

  console.log('--- VERIFICATION TESTS COMPLETED ---');
  if (testsFailed === 0) {
    console.log('🎉 ALL SECURITY VERIFICATION TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.log(`🚨 ${testsFailed} TEST(S) FAILED.`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
