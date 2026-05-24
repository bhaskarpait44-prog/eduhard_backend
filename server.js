'use strict';

/**
 * server.js
 * Application entry point.
 * - Loads env vars
 * - Authenticates database connection
 * - Starts HTTP server
 */

require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Application cannot start.');
  process.exit(1);
}

const logger = require('./utils/logger');
const sequelize = require('./config/database');
const app = require('./app');
const { initBrowser } = require('./utils/pdfGenerator');
const { initializeFirebase } = require('./utils/firebase');

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function boot() {
  try {
    logger.info(`Starting EduCore API [${NODE_ENV}]...`);

    await sequelize.authenticate();
    
    initializeFirebase();
    
    // ONE-TIME FIX: Add missing columns and ENUMs to notices table
    const applyFix = async (query, description) => {
      try {
        await sequelize.query(query);
        // logger.info(`Schema fix applied: ${description}`);
      } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
           logger.error(`Failed schema fix [${description}]:`, e.message);
        }
      }
    };

    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'teachers'", "ENUM audience: teachers");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'parents'", "ENUM audience: parents");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'accountants'", "ENUM audience: accountants");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'librarians'", "ENUM audience: librarians");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'receptionists'", "ENUM audience: receptionists");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'specific_teacher'", "ENUM audience: specific_teacher");
    await applyFix("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'subject_wise'", "ENUM audience: subject_wise");
    
    await applyFix("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'super_admin'", "ENUM role: super_admin");
    await applyFix("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'accountant'", "ENUM role: accountant");
    await applyFix("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'staff'", "ENUM role: staff");
    
    await applyFix('ALTER TABLE notices ADD COLUMN IF NOT EXISTS target_teacher_id INTEGER', "Column: target_teacher_id");
    await applyFix('ALTER TABLE notices ADD COLUMN IF NOT EXISTS target_subject_id INTEGER', "Column: target_subject_id");
    await applyFix('ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_school_wide BOOLEAN DEFAULT FALSE', "Column: is_school_wide");
    await applyFix('ALTER TABLE notices ADD COLUMN IF NOT EXISTS attachment_path VARCHAR(500)', "Column: attachment_path");
    
    // Fix notice_reads for teachers
    await applyFix('ALTER TABLE notice_reads ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id) ON DELETE CASCADE', "Column: notice_reads.teacher_id");
    await applyFix('CREATE UNIQUE INDEX IF NOT EXISTS notice_reads_notice_teacher_unique ON notice_reads (notice_id, teacher_id)', "Index: notice_reads_notice_teacher_unique");
    
    // Fix teacher_notice_reads to allow teacher_id or user_id
    // We'll just add a teacher_id column to it as well if it doesn't exist
    await applyFix('ALTER TABLE teacher_notice_reads ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id) ON DELETE CASCADE', "Column: teacher_notice_reads.teacher_id");
    await applyFix('CREATE UNIQUE INDEX IF NOT EXISTS teacher_notice_reads_notice_teacher_unique ON teacher_notice_reads (notice_id, teacher_id)', "Index: teacher_notice_reads_notice_teacher_unique");
    
    // Clean up absolute paths in database to make them web-accessible
    try {
      await sequelize.query(`
        UPDATE notices 
        SET attachment_path = SUBSTRING(attachment_path FROM 'uploads/notices/.*')
        WHERE attachment_path LIKE '%uploads/notices/%' AND attachment_path NOT LIKE 'uploads/notices/%'
      `);
      await sequelize.query(`
        UPDATE teacher_notices 
        SET attachment_path = SUBSTRING(attachment_path FROM 'uploads/notices/.*')
        WHERE attachment_path LIKE '%uploads/notices/%' AND attachment_path NOT LIKE 'uploads/notices/%'
      `);
    } catch (e) {
      logger.error('Failed to clean up attachment paths:', e.message);
    }
    
    // Pre-warm Puppeteer browser for fast PDF generation
    await initBrowser();

    if (process.env.DATABASE_URL) {
      logger.info('Database connected using DATABASE_URL');
    } else {
      logger.info(`Database connected -> ${process.env.DB_DIALECT}://${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
    }

    app.listen(PORT, '0.0.0.0', () => {
      const LOCAL_IP = '10.241.71.32';
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Local access: http://localhost:${PORT}`);
      logger.info(`Mobile access: http://${LOCAL_IP}:${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to connect to database:', error.message);
    if (error.stack) logger.error(error.stack);
    logger.error('Check your .env DB_* variables and ensure the database server is running.');
    process.exit(1);
  }
}

boot();
