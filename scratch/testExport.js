const fs = require('fs');
const db = require('../config/database');
const studentPortalController = require('../controllers/studentPortalController');

const mockReq = {
  user: {
    id: 2,
    student_id: 2,
    school_id: 1,
    role: 'student'
  },
  params: {
    examId: 1
  }
};

const fileStream = fs.createWriteStream('test_output_exam.pdf');

const mockRes = {
  headers: {},
  setHeader: function(k, v) { this.headers[k] = v; },
  pipe: function(dest) { return fileStream.pipe(dest); }, // wait, pdfkit's doc.pipe(res) expects res to be the destination stream!
  // so we can just pass the fileStream as res!
};

// Let's copy all Express response methods to fileStream
fileStream.setHeader = function(k, v) { console.log('Header set:', k, '->', v); };
fileStream.fail = function(msg, errors, code) { console.error('Failed response:', code, msg, errors); };
fileStream.ok = function(data, msg) { console.log('OK response:', msg, data); };

studentPortalController.resultsExport(mockReq, fileStream, (err) => {
  if (err) {
    console.error('CRASHED WITH ERROR:', err);
  } else {
    console.log('Finished successfully');
  }
});
