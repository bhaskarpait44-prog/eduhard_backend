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
    console.log('❌ TEST 3 FAILED with error:', err.message);
    testsFailed++;
  } finally {
    // Clean up temporary assignment
    await db.query(`DELETE FROM teacher_assignments WHERE id = ${tempAssignmentId}`);
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
