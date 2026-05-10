'use strict';

const PDFDocument = require('pdfkit');

/**
 * Generates a PDF report card using PDFKit.
 * @param {Object} data - The data to populate the report card.
 * @returns {Promise<Buffer>} - The generated PDF as a buffer.
 */
async function generateReportCard(data) {
  const { school, student, enrollment, session, results, attendance, finalResult } = data;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // --- Header ---
      doc.fillColor('#2c3e50').fontSize(24).text(school.name, { align: 'center' });
      doc.fontSize(10).text(`${school.address || ''} | Phone: ${school.phone || ''}`, { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(16).text('ANNUAL PROGRESS REPORT', { align: 'center', underline: true });
      doc.fontSize(12).text(`Academic Session: ${session.name}`, { align: 'center' });
      doc.moveDown(2);

      // --- Student Info ---
      doc.fontSize(11);
      const startY = doc.y;
      doc.text(`Student Name: ${student.first_name} ${student.last_name}`, 50, startY);
      doc.text(`Admission No: ${student.admission_no}`, 50, startY + 20);
      doc.text(`Roll Number: ${enrollment.roll_number || 'N/A'}`, 50, startY + 40);

      doc.text(`Class: ${enrollment.class_name}`, 350, startY);
      doc.text(`Section: ${enrollment.section_name || 'N/A'}`, 350, startY + 20);
      doc.text(`Father's Name: ${student.father_name || 'N/A'}`, 350, startY + 40);
      
      doc.moveDown(4);

      // --- Results Table ---
      doc.font('Helvetica-Bold').fontSize(12).text('ACADEMIC PERFORMANCE', { underline: true });
      doc.moveDown(0.5);
      
      const tableTop = doc.y;
      const col1 = 50, col2 = 180, col3 = 250, col4 = 320, col5 = 400, col6 = 480, col7 = 540;
      
      doc.fontSize(10);
      doc.text('Subject', col1, tableTop);
      doc.text('Theory', col2, tableTop);
      doc.text('Prac.', col3, tableTop);
      doc.text('Total', col4, tableTop);
      doc.text('Obt.', col5, tableTop);
      doc.text('Grade', col6, tableTop);
      doc.text('Status', col7, tableTop);
      
      doc.moveTo(50, tableTop + 15).lineTo(580, tableTop + 15).stroke();
      
      let y = tableTop + 25;
      doc.font('Helvetica');
      results.forEach(r => {
        doc.text(r.subject, col1, y);
        doc.text(r.theory_marks_obtained !== null ? `${r.theory_marks_obtained}/${r.theory_total}` : '-', col2, y);
        doc.text(r.practical_marks_obtained !== null ? `${r.practical_marks_obtained}/${r.practical_total}` : '-', col3, y);
        doc.text(String(r.total_marks), col4, y);
        doc.text(r.is_absent ? 'ABSENT' : String(r.marks_obtained), col5, y);
        doc.text(r.grade, col6, y);
        doc.text(r.is_pass ? 'PASS' : 'FAIL', col7, y);
        y += 20;
      });

      doc.moveDown(2);

      // --- Summary ---
      const summaryY = doc.y;
      doc.font('Helvetica-Bold').text('SUMMARY', 50, summaryY);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Aggregate Marks: ${finalResult.marks_obtained} / ${finalResult.total_marks}`, 50, summaryY + 20);
      doc.text(`Percentage: ${finalResult.percentage}%`, 50, summaryY + 35);
      doc.text(`Overall Grade: ${finalResult.grade}`, 50, summaryY + 50);
      doc.text(`Final Result: ${finalResult.result.toUpperCase()}`, 50, summaryY + 65);

      doc.text(`Attendance: ${attendance.percentage}%`, 350, summaryY + 20);
      doc.text(`Days Present: ${attendance.effectivePresent} / ${attendance.workingDays}`, 350, summaryY + 35);

      doc.moveDown(5);

      // --- Signatures ---
      const sigY = doc.y;
      doc.moveTo(50, sigY).lineTo(150, sigY).stroke();
      doc.text('Class Teacher', 50, sigY + 5, { width: 100, align: 'center' });

      doc.moveTo(250, sigY).lineTo(350, sigY).stroke();
      doc.text('Principal', 250, sigY + 5, { width: 100, align: 'center' });

      doc.moveTo(450, sigY).lineTo(550, sigY).stroke();
      doc.text("Parent's Signature", 450, sigY + 5, { width: 100, align: 'center' });

      doc.end();
    } catch (err) { reject(err); }
  });
}

/**
 * Simplified init (no browser needed for PDFKit)
 */
async function initBrowser() {
  console.log('✅ PDF Engine initialized (PDFKit)');
}

module.exports = { generateReportCard, initBrowser };
