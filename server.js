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
require('./utils/libraryScheduler');
require('./utils/studentScheduler');

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function boot() {
  try {
    logger.info(`Starting EduCore API [${NODE_ENV}]...`);

    await sequelize.authenticate();
    
    initializeFirebase();
    
    // Pre-warm Puppeteer browser for fast PDF generation
    await initBrowser();

    if (process.env.DATABASE_URL) {
      logger.info('Database connected using DATABASE_URL');
    } else {
      logger.info(`Database connected -> ${process.env.DB_DIALECT}://${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
    }

    app.listen(PORT, '0.0.0.0', () => {
      const os = require('os');
      const networkInterfaces = os.networkInterfaces();
      let localIp = 'localhost';
      
      for (const interfaceName in networkInterfaces) {
        for (const iface of networkInterfaces[interfaceName]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            localIp = iface.address;
            break;
          }
        }
        if (localIp !== 'localhost') break;
      }

      logger.info(`Server running on port ${PORT}`);
      logger.info(`Local access: http://localhost:${PORT}`);
      logger.info(`Mobile access: http://${localIp}:${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/status`);
    });
  } catch (error) {
    logger.error('Failed to connect to database:', error.message);
    if (error.stack) logger.error(error.stack);
    logger.error('Check your .env DB_* variables and ensure the database server is running.');
    process.exit(1);
  }
}

boot();
