'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Controller for secure file serving
 */
exports.serveFile = (req, res) => {
  const { filename } = req.params;
  
  // Security: Prevent path traversal by only taking the basename
  const safeFilename = path.basename(filename);
  const filePath = path.join(__dirname, '../uploads', safeFilename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: 'File not found'
    });
  }

  // Optional: Add fine-grained access control here if needed
  // For now, we allow all authenticated users (students, teachers, staff, parents)
  // to access files, as they are part of the school system.

  res.sendFile(filePath);
};
