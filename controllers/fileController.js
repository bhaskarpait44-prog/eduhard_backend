'use strict';

const path = require('path');
const fs = require('fs');
const sequelize = require('../config/database');

async function getFileMetadata(safeFilename) {
  const pattern = `%${safeFilename}`;
  
  // 1. Check notices
  const [[notice]] = await sequelize.query(`
    SELECT school_id, attachment_path AS file_path FROM notices WHERE attachment_path LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (notice) return { schoolId: notice.school_id, relativePath: notice.file_path };

  // 2. Check teacher_notices
  const [[tNotice]] = await sequelize.query(`
    SELECT t.school_id, tn.attachment_path AS file_path 
    FROM teacher_notices tn 
    JOIN teachers t ON t.id = tn.teacher_id 
    WHERE tn.attachment_path LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (tNotice) return { schoolId: tNotice.school_id, relativePath: tNotice.file_path };

  // 3. Check student_documents
  const [[sDoc]] = await sequelize.query(`
    SELECT s.school_id, sd.file_path 
    FROM student_documents sd 
    JOIN students s ON s.id = sd.student_id 
    WHERE sd.file_path LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (sDoc) return { schoolId: sDoc.school_id, relativePath: sDoc.file_path };

  // 4. Check study_materials
  const [[sMat]] = await sequelize.query(`
    SELECT t.school_id, sm.file_path 
    FROM study_materials sm 
    JOIN teachers t ON t.id = sm.teacher_id 
    WHERE sm.file_path LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (sMat) return { schoolId: sMat.school_id, relativePath: sMat.file_path };

  // 5. Check homework
  const [[hw]] = await sequelize.query(`
    SELECT t.school_id, h.attachment_path AS file_path 
    FROM homework h 
    JOIN teachers t ON t.id = h.teacher_id 
    WHERE h.attachment_path LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (hw) return { schoolId: hw.school_id, relativePath: hw.file_path };

  // 6. Check homework_submissions
  const [[hwSub]] = await sequelize.query(`
    SELECT t.school_id, hs.attachment_path AS file_path 
    FROM homework_submissions hs 
    JOIN homework h ON h.id = hs.homework_id 
    JOIN teachers t ON t.id = h.teacher_id 
    WHERE hs.attachment_path LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (hwSub) return { schoolId: hwSub.school_id, relativePath: hwSub.file_path };

  // 7. Check teachers profile_photo
  const [[teacher]] = await sequelize.query(`
    SELECT school_id, profile_photo AS file_path FROM teachers WHERE profile_photo LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (teacher) return { schoolId: teacher.school_id, relativePath: teacher.file_path };

  // 8. Check users profile_photo
  const [[user]] = await sequelize.query(`
    SELECT school_id, profile_photo AS file_path FROM users WHERE profile_photo LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (user) return { schoolId: user.school_id, relativePath: user.file_path };

  // 9. Check applications
  const [[app]] = await sequelize.query(`
    SELECT school_id, student_data FROM applications WHERE student_data::text LIKE :pattern LIMIT 1
  `, { replacements: { pattern } });
  if (app) {
    const docs = app.student_data?.documents || {};
    let matchedPath = null;
    for (const key in docs) {
      if (docs[key]?.includes(safeFilename)) {
        matchedPath = docs[key];
        break;
      }
    }
    return { schoolId: app.school_id, relativePath: matchedPath };
  }

  return null;
}

/**
 * Controller for secure file serving
 */
exports.serveFile = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const reqPath = decodeURIComponent(req.path.replace(/^\//, ''));
    
    let safeFilename = path.basename(reqPath);

    const metadata = await getFileMetadata(safeFilename);

    // Strict deny-by-default: metadata must resolve, and it must contain a valid relativePath
    if (!metadata || !metadata.relativePath) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (Number(metadata.schoolId) !== Number(schoolId)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const filePath = path.resolve(__dirname, '..', metadata.relativePath);
    const UPLOADS_BASE = path.resolve(__dirname, '..', 'uploads');

    // Prevent path traversal outside the uploads directory
    if (!filePath.startsWith(UPLOADS_BASE + path.sep) && filePath !== UPLOADS_BASE) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
};
