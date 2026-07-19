'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('../app');
const sequelize = require('../config/database');

const PORT = 5055;
const JWT_SECRET = process.env.JWT_SECRET || 'your_very_secure_random_secret_string';

// Helper to make HTTP requests
function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            body: data,
          });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTest() {
  let server;
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();

    console.log('Starting temporary test server...');
    server = app.listen(PORT, async () => {
      console.log(`Test server listening on port ${PORT}`);
      try {
        // 1. Initialize QR Login
        console.log('\n--- Test 1: Initialize QR Session ---');
        const initRes = await makeRequest('POST', '/api/auth/qr/init');
        console.log('Response status:', initRes.statusCode);
        console.log('Response body:', initRes.body);

        if (!initRes.body.success || !initRes.body.data.token) {
          throw new Error('QR Initialization failed');
        }
        const token = initRes.body.data.token;
        console.log('Generated token:', token);

        // 2. Check Status (should be pending)
        console.log('\n--- Test 2: Check QR Status (Pending) ---');
        const statusPendingRes = await makeRequest('GET', `/api/auth/qr/status/${token}`);
        console.log('Response status:', statusPendingRes.statusCode);
        console.log('Response body:', statusPendingRes.body);

        if (statusPendingRes.body.data.status !== 'pending') {
          throw new Error('Expected status to be pending');
        }

        // 3. Confirm scan (requires auth)
        console.log('\n--- Test 3: Confirm QR Login (Authenticated Teacher) ---');
        const [[teacher]] = await sequelize.query('SELECT id, school_id, email, first_name, last_name FROM teachers LIMIT 1;');
        if (!teacher) {
          console.warn('⚠️ No teachers found in database. Inserting a dummy teacher for test...');
          await sequelize.query(`
            INSERT INTO teachers (id, school_id, email, first_name, last_name, password_hash, is_active, is_deleted, created_at, updated_at)
            VALUES (9999, 1, 'test.teacher@example.com', 'Test', 'Teacher', 'dummy', true, false, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING;
          `);
        }
        const teacherId = teacher ? teacher.id : 9999;
        const schoolId = teacher ? teacher.school_id : 1;
        const email = teacher ? teacher.email : 'test.teacher@example.com';
        const name = teacher ? `${teacher.first_name} ${teacher.last_name}` : 'Test Teacher';

        const teacherPayload = {
          userId: teacherId,
          schoolId: schoolId,
          role: 'teacher',
          name: name,
          email: email,
        };
        const teacherJwt = jwt.sign(teacherPayload, JWT_SECRET, { expiresIn: '1h' });

        const confirmRes = await makeRequest(
          'POST',
          '/api/auth/qr/confirm',
          { token },
          { Authorization: `Bearer ${teacherJwt}` }
        );
        console.log('Response status:', confirmRes.statusCode);
        console.log('Response body:', confirmRes.body);

        if (!confirmRes.body.success) {
          throw new Error('QR confirmation failed');
        }

        // 4. Check Status again (should be authorized)
        console.log('\n--- Test 4: Check QR Status (Authorized) ---');
        const statusAuthRes = await makeRequest('GET', `/api/auth/qr/status/${token}`);
        console.log('Response status:', statusAuthRes.statusCode);
        console.log('Response body:', statusAuthRes.body);

        if (statusAuthRes.body.data.status !== 'authorized' || !statusAuthRes.body.data.token) {
          throw new Error('Expected status to be authorized with token');
        }
        console.log('Successfully logged in with QR code!');

        // 5. Check Status again (should be expired because single-use token was deleted)
        console.log('\n--- Test 5: Re-check QR Status (Should be Expired/Deleted) ---');
        const statusExpiredRes = await makeRequest('GET', `/api/auth/qr/status/${token}`);
        console.log('Response status:', statusExpiredRes.statusCode);
        console.log('Response body:', statusExpiredRes.body);

        if (statusExpiredRes.body.data.status !== 'expired') {
          throw new Error('Expected session to be expired or deleted after login');
        }

        console.log('\n✅ ALL BACKEND QR LOGIN TESTS PASSED SUCCESSFULLY!');
        cleanupAndExit(0);
      } catch (err) {
        console.error('\n❌ Test execution error:', err.message);
        cleanupAndExit(1);
      }
    });
  } catch (err) {
    console.error('Setup failed:', err.message);
    cleanupAndExit(1);
  }

  function cleanupAndExit(code) {
    if (server) {
      server.close(() => {
        console.log('Test server closed.');
        process.exit(code);
      });
    } else {
      process.exit(code);
    }
  }
}

runTest();
