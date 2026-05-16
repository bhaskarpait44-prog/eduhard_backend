'use strict';

/**
 * server.js
 * Application entry point.
 * - Loads env vars
 * - Authenticates database connection
 * - Starts HTTP server
 */

require('dotenv').config();
const logger = require('./utils/logger');
const sequelize = require('./config/database');
const app = require('./app');
const { initBrowser } = require('./utils/pdfGenerator');

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function boot() {
  try {
    logger.info(`Starting EduCore API [${NODE_ENV}]...`);

    await sequelize.authenticate();
    
    // ONE-TIME FIX: Add missing columns and ENUMs to notices table
    try {
      await sequelize.query("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'teachers'");
      await sequelize.query("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'parents'");
      await sequelize.query("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'accountants'");
      await sequelize.query("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'specific_teacher'");
      await sequelize.query("ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'subject_wise'");
      
      await sequelize.query("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'super_admin'");
      await sequelize.query("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'accountant'");
      await sequelize.query("ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'staff'");
      
      await sequelize.query('ALTER TABLE notices ADD COLUMN IF NOT EXISTS target_teacher_id INTEGER');
      await sequelize.query('ALTER TABLE notices ADD COLUMN IF NOT EXISTS target_subject_id INTEGER');
      await sequelize.query('ALTER TABLE notices ADD COLUMN IF NOT EXISTS is_school_wide BOOLEAN DEFAULT FALSE');
      await sequelize.query('ALTER TABLE notices ADD COLUMN IF NOT EXISTS attachment_path VARCHAR(500)');
    } catch (e) {
      logger.error('Failed to apply schema fixes for notices table:', e.message);
    }
    
    // Pre-warm Puppeteer browser for fast PDF generation
    await initBrowser();

    if (process.env.DATABASE_URL) {
      logger.info('Database connected using DATABASE_URL');
    } else {
      logger.info(`Database connected -> ${process.env.DB_DIALECT}://${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
    }

    app.listen(PORT, '0.0.0.0', () => {
      const LOCAL_IP = '10.137.4.32';
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
