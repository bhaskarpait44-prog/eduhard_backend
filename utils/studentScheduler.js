'use strict';

/**
 * studentScheduler.js
 * Automated cron jobs for the Student module.
 * - Nightly at 02:00: Clean up orphaned files (documents & profile photos) of soft-deleted students older than 30 days.
 */

const cron = require('node-cron');
const fs = require('fs');
const sequelize = require('../config/database');
const logger = require('./logger');

const cleanOrphanedStudentFiles = async () => {
  try {
    logger.info('[StudentScheduler] Running nightly cleanup of soft-deleted student files...');

    // 1. Fetch documents of soft-deleted students older than 30 days
    const [docs] = await sequelize.query(`
      SELECT sd.id, sd.file_path
      FROM student_documents sd
      JOIN students s ON s.id = sd.student_id
      WHERE s.is_deleted = true AND s.updated_at < NOW() - INTERVAL '30 days';
    `);

    let docFilesDeletedCount = 0;
    let docRowsDeletedCount = 0;

    for (const doc of docs) {
      if (doc.file_path) {
        try {
          if (fs.existsSync(doc.file_path)) {
            fs.unlinkSync(doc.file_path);
            docFilesDeletedCount++;
          }
        } catch (fileErr) {
          logger.error(`[StudentScheduler] Failed to delete file on disk ${doc.file_path}: ${fileErr.message}`);
        }
      }

      await sequelize.query(`DELETE FROM student_documents WHERE id = :id;`, {
        replacements: { id: doc.id }
      });
      docRowsDeletedCount++;
    }

    // 2. Fetch profile photos of soft-deleted students older than 30 days
    const [profiles] = await sequelize.query(`
      SELECT sp.id, sp.photo_path
      FROM student_profiles sp
      JOIN students s ON s.id = sp.student_id
      WHERE s.is_deleted = true AND s.updated_at < NOW() - INTERVAL '30 days' AND sp.photo_path IS NOT NULL AND sp.photo_path <> '';
    `);

    let photosDeletedCount = 0;

    for (const profile of profiles) {
      if (profile.photo_path) {
        try {
          if (fs.existsSync(profile.photo_path)) {
            fs.unlinkSync(profile.photo_path);
            photosDeletedCount++;
          }
        } catch (fileErr) {
          logger.error(`[StudentScheduler] Failed to delete photo on disk ${profile.photo_path}: ${fileErr.message}`);
        }
      }
      
      // Update profile to clear photo_path to prevent duplicate attempts
      await sequelize.query(`UPDATE student_profiles SET photo_path = NULL WHERE id = :id;`, {
        replacements: { id: profile.id }
      });
    }

    if (docRowsDeletedCount > 0 || photosDeletedCount > 0) {
      logger.info(`[StudentScheduler] Cleanup finished: Deleted ${docFilesDeletedCount} documents and ${photosDeletedCount} profile photos from disk.`);
    }
  } catch (err) {
    logger.error('[StudentScheduler] Error cleaning soft-deleted student files: ' + err.message);
  }
};

// Schedule: nightly at 02:00
cron.schedule('0 2 * * *', () => {
  cleanOrphanedStudentFiles();
});

logger.info('[StudentScheduler] Student scheduler initialized.');

module.exports = { cleanOrphanedStudentFiles };
