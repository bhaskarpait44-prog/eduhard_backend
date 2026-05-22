'use strict';

const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../notification_debug.log');

function logNotification(msg, data = null) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}\n`;
  
  // Console log with prominent prefix
  console.log(`\x1b[33m%s\x1b[0m`, `[NOTIFICATION-DEBUG] ${msg}`);
  if (data) console.log(JSON.stringify(data, null, 2));

  // File log
  try {
    fs.appendFileSync(logFile, logMsg);
  } catch (err) {
    console.error('Failed to write to notification log file:', err.message);
  }
}

module.exports = { logNotification };
