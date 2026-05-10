'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

require('./models');

const respond = require('./middlewares/respond');
const errorHandler = require('./middlewares/errorHandler');
const { apiLimiter } = require('./middlewares/rateLimiter');
const { authenticate, requireRole } = require('./middlewares/auth');
const enforcePasswordChange = require('./middlewares/enforcePasswordChange');
const {
  requirePermission,
  attachUserPermissions,
} = require('./middlewares/checkPermission');

const app = express();
console.log('[App] Initializing EduCore API v2 (PDFKit Ready)...');

const corsOrigins = (() => {
  if (process.env.NODE_ENV === 'development') return true;
  
  const raw = process.env.CORS_ORIGIN;
  if (!raw || raw.trim() === '*') return true;

  const allowed = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Include common local dev origins by default.
    [
    'http://localhost',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1',
    'http://127.0.0.1:3000',
  ].forEach((origin) => {
    if (!allowed.includes(origin)) allowed.push(origin);
  });

  return function originValidator(origin, callback) {
    if (!origin || allowed.includes(origin)) return callback(null, true);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[CORS] Blocked origin: ${origin}`);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  };
})();

app.use(helmet());
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(respond);

// Static folders
app.use('/uploads', express.static('uploads'));

app.use('/api', apiLimiter);

app.get('/api/health', (req, res) =>
  res.ok({ status: 'ok', timestamp: new Date() })
);

app.use('/api/auth', require('./routes/auth'));

app.use('/api', authenticate, attachUserPermissions, enforcePasswordChange);

app.use('/api/students', require('./routes/students'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/sections', require('./routes/sections'));
app.use('/api/enrollments', require('./routes/enrollments'));
app.use('/api/student-subjects', require('./routes/studentSubjects'));

app.use('/api/attendance',
  requirePermission('attendance.view'),
  require('./routes/attendance')
);

app.use('/api/fees',
  requirePermission('fees.view'),
  require('./routes/fees')
);

app.use('/api/accountant',
  requireRole('admin', 'accountant'),
  require('./routes/accountant')
);

app.use('/api/exams',
  requirePermission('exams.view'),
  require('./routes/exams')
);

app.use('/api/analytics', require('./routes/analytics'));

app.use('/api/results',
  requirePermission('results.view'),
  require('./routes/results')
);

app.use('/api/admin/users',
  requirePermission('users.view'),
  require('./routes/userManagement')
);

app.use('/api/admin/teacher-control',
  requirePermission('users.view'),
  require('./routes/adminTeacherControl')
);

app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/student', require('./routes/student'));

app.use('/api/audit',
  requirePermission('audit.view'),
  require('./routes/audit')
);

app.use('/api/notices', require('./routes/notices'));

// Missing or regrouped routes as requested in PART 1
app.use('/api/library', require('./routes/library'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/transport', require('./routes/transport'));
app.use('/api/health', require('./routes/health'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/families', require('./routes/families'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/parent', require('./routes/parent'));
app.use('/api/staff-attendance', require('./routes/staffAttendance'));
app.use('/api/student-leaving', require('./routes/studentLeaving'));

app.use((req, res) =>
  res.fail(`Route ${req.method} ${req.path} not found.`, [], 404)
);

app.use(errorHandler);

module.exports = app;
