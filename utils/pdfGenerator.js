'use strict';

const PDFDocument = require('pdfkit');

/**
 * Reusable helper to draw school header on PDF
 */
function drawSchoolHeader(doc, school = {}, title, subTitle) {
  const schoolName = school.name || 'School Management System';
  const schoolAddress = school.address || '';
  const schoolPhone = school.phone || '';
  const schoolEmail = school.email || '';

  doc.fillColor('#2c3e50').fontSize(22).font('Helvetica-Bold').text(schoolName, { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(`${schoolAddress}${schoolAddress && schoolPhone ? ' | ' : ''}${schoolPhone ? 'Phone: ' + schoolPhone : ''}`, { align: 'center' });
  if (schoolEmail) doc.fontSize(10).text(`Email: ${schoolEmail}`, { align: 'center' });
  
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#eee').stroke();
  doc.moveDown(1);
  
  if (title) {
    doc.fillColor('#2c3e50').fontSize(16).font('Helvetica-Bold').text(title, { align: 'center', underline: false });
  }
  if (subTitle) {
    doc.fontSize(11).font('Helvetica').text(subTitle, { align: 'center' });
  }
  doc.moveDown(1.5);
}

/**
 * Generates a PDF report card using PDFKit.
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
      drawSchoolHeader(doc, school, 'ANNUAL PROGRESS REPORT', `Academic Session: ${session.name}`);

      // --- Student Info ---
      doc.fontSize(11).font('Helvetica');
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
      
      doc.moveTo(50, tableTop + 15).lineTo(580, tableTop + 15).strokeColor('#333').stroke();
      
      let y = tableTop + 25;
      doc.font('Helvetica');
      results.forEach(r => {
        if (y > 750) { doc.addPage(); y = 50; }
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
 * Generates an Academic Calendar PDF using PDFKit.
 */
async function generateAcademicCalendarPdf(data) {
  const { school = {}, session = {}, events = [] } = data;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // --- Header ---
      drawSchoolHeader(doc, school, 'ACADEMIC CALENDAR', `Session: ${session.name || 'N/A'}`);

      // --- Table Header ---
      const tableTop = doc.y;
      const colDate = 50, colTitle = 130, colType = 320, colAudience = 420, colClass = 500;
      
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Date', colDate, tableTop);
      doc.text('Event Title', colTitle, tableTop);
      doc.text('Type', colType, tableTop);
      doc.text('Audience', colAudience, tableTop);
      doc.text('Class', colClass, tableTop);
      
      doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).strokeColor('#ccc').stroke();
      
      let y = tableTop + 25;
      doc.font('Helvetica');

      if (events.length === 0) {
        doc.text('No events scheduled for this period.', 50, y, { align: 'center', width: 495 });
      } else {
        events.forEach(event => {
          // Check for page break
          if (y > 750) {
            doc.addPage();
            y = 50;
            // Redraw table header on new page if needed, but for calendar a simple list is fine
          }

          const dateStr = event.start_date === event.end_date 
            ? event.start_date 
            : `${event.start_date} to ${event.end_date}`;

          doc.fontSize(9);
          doc.text(dateStr, colDate, y, { width: 75 });
          doc.text(event.title, colTitle, y, { width: 180 });
          doc.text(event.event_type.replace('_', ' ').toUpperCase(), colType, y, { width: 90 });
          doc.text(event.audience.toUpperCase(), colAudience, y, { width: 75 });
          doc.text(event.target_class_name || 'All', colClass, y, { width: 45 });

          y += Math.max(25, doc.heightOfString(event.title, { width: 180 }) + 10);
          
          // Row separator
          doc.moveTo(50, y - 5).lineTo(545, y - 5).strokeColor('#f0f0f0').stroke();
        });
      }

      // --- Footer ---
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#999').text(
          `Generated on ${new Date().toLocaleDateString()} | Page ${i + 1} of ${pageCount}`,
          50,
          doc.page.height - 50,
          { align: 'center' }
        );
      }

      doc.end();
    } catch (err) { reject(err); }
  });
}

/**
 * Generates an Admission Form PDF summary.
 */
async function generateAdmissionForm(data) {
  const { school = {}, student = {}, profile = {}, enrollment = {}, session = {}, academicRecords = [] } = data;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // --- Header ---
      drawSchoolHeader(doc, school, 'ADMISSION FORM', `Session: ${session.name || 'N/A'}`);

      // --- Student Info ---
      doc.font('Helvetica-Bold').fontSize(12).text('STUDENT PROFILE', { underline: true });
      doc.moveDown(0.5);

      doc.font('Helvetica').fontSize(10);
      const colA = 50, colB = 300;
      let curY = doc.y;

      const fields = [
        { label: 'Name of pupil', value: `${student.first_name} ${student.last_name}`.toUpperCase() },
        { label: 'Admission No', value: student.admission_no },
        { label: 'Date of Birth', value: student.date_of_birth },
        { label: 'Aadhar No', value: student.aadhar_no || 'N/A' },
        { label: 'Gender', value: student.gender?.toUpperCase() },
        { label: 'Nationality', value: profile.nationality || 'Indian' },
        { label: 'Religion', value: profile.religion || 'N/A' },
        { label: 'Caste', value: profile.caste || 'N/A' },
        { label: 'Mother Tongue', value: profile.mother_tongue || 'N/A' },
        { label: 'Blood Group', value: profile.blood_group || 'N/A' },
        { label: 'Class', value: enrollment.class_name },
        { label: 'Section', value: enrollment.section_name || 'N/A' },
        { label: 'Stream', value: enrollment.stream?.toUpperCase() || 'REGULAR' },
        { label: 'Medium', value: profile.medium || 'English' },
        { label: 'APAAR ID', value: profile.apaar_id || 'N/A' },
        { label: 'PEN No', value: profile.pen_no || 'N/A' },
      ];

      fields.forEach((f, i) => {
        const x = i % 2 === 0 ? colA : colB;
        doc.font('Helvetica-Bold').text(`${f.label}: `, x, curY, { continued: true })
           .font('Helvetica').text(f.value || 'N/A');
        if (i % 2 !== 0) curY += 18;
      });

      doc.moveDown(1.5);

      // --- Address Info ---
      doc.font('Helvetica-Bold').fontSize(12).text('RESIDENTIAL ADDRESS', { underline: true });
      doc.moveDown(0.5);

      const addrY = doc.y;
      doc.fontSize(9);
      
      // Current
      doc.font('Helvetica-Bold').text('CURRENT ADDRESS', colA, addrY);
      doc.font('Helvetica').text(profile.address || 'N/A', colA, addrY + 15, { width: 230 });
      doc.text(`P.S.: ${profile.police_station || 'N/A'} | P.O.: ${profile.post_office || 'N/A'}`, colA, addrY + 45);
      doc.text(`${profile.district || 'N/A'}, ${profile.state || 'N/A'} - ${profile.pincode || 'N/A'}`, colA, addrY + 60);

      // Permanent
      doc.font('Helvetica-Bold').text('PERMANENT ADDRESS', colB, addrY);
      const pAddr = profile.is_permanent_same ? profile.address : profile.perm_address;
      const pPS = profile.is_permanent_same ? profile.police_station : profile.perm_police_station;
      const pPO = profile.is_permanent_same ? profile.post_office : profile.perm_post_office;
      const pDist = profile.is_permanent_same ? profile.district : profile.perm_district;
      const pState = profile.is_permanent_same ? profile.state : profile.perm_state;
      const pPin = profile.is_permanent_same ? profile.pincode : profile.perm_pincode;

      doc.font('Helvetica').text(pAddr || 'N/A', colB, addrY + 15, { width: 230 });
      doc.text(`P.S.: ${pPS || 'N/A'} | P.O.: ${pPO || 'N/A'}`, colB, addrY + 45);
      doc.text(`${pDist || 'N/A'}, ${pState || 'N/A'} - ${pPin || 'N/A'}`, colB, addrY + 60);

      doc.y = addrY + 80;
      doc.moveDown(1.5);

      // --- Parents Info ---
      doc.font('Helvetica-Bold').fontSize(12).text("PARENTS' / GUARDIAN'S PROFILE", { underline: true });
      doc.moveDown(0.5);
      
      const parentFields = [
        ['PARTICULAR', 'MOTHER', 'FATHER', 'GUARDIAN'],
        ['Name', profile.mother_name || 'N/A', profile.father_name || 'N/A', profile.guardian_name || 'N/A'],
        ['Qualification', profile.mother_qualification || 'N/A', profile.father_qualification || 'N/A', profile.guardian_qualification || 'N/A'],
        ['Mobile No.', profile.mother_phone || 'N/A', profile.father_phone || 'N/A', profile.guardian_phone || 'N/A'],
        ['Aadhar No.', profile.mother_aadhar || 'N/A', profile.father_aadhar || 'N/A', profile.guardian_aadhar || 'N/A'],
        ['Annual Income', profile.mother_annual_income || 'N/A', profile.father_annual_income || 'N/A', profile.guardian_annual_income || 'N/A'],
      ];

      const cellWidth = 125;
      let tableY = doc.y;
      parentFields.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          doc.font(rowIndex === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
          doc.text(cell, colA + (colIndex * cellWidth), tableY, { width: cellWidth, align: 'left' });
        });
        tableY += 20;
        doc.moveTo(colA, tableY - 5).lineTo(545, tableY - 5).strokeColor('#eee').stroke();
      });

      doc.moveDown(1.5);

      // --- Academic Records ---
      if (academicRecords.length > 0) {
        doc.font('Helvetica-Bold').fontSize(12).text('PREVIOUS ACADEMIC RECORD', { underline: true });
        doc.moveDown(0.5);
        
        const headerY = doc.y;
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('School & Location', colA, headerY, { width: 180 });
        doc.text('Class', colA + 200, headerY, { width: 50 });
        doc.text('Year', colA + 270, headerY, { width: 60 });
        doc.text('Percentage/Grade', colA + 350, headerY, { width: 100 });
        
        let recY = headerY + 15;
        doc.font('Helvetica');
        academicRecords.forEach(rec => {
          doc.text(rec.school_name, colA, recY, { width: 180 });
          doc.text(rec.class_name, colA + 200, recY);
          doc.text(rec.year_of_study || 'N/A', colA + 270, recY);
          doc.text(rec.percentage_grade || 'N/A', colA + 350, recY);
          recY += 15;
        });
        doc.moveDown(2);
      }

      // --- Footer ---
      doc.moveDown(3);
      const sigY = doc.y;
      doc.moveTo(50, sigY).lineTo(150, sigY).stroke();
      doc.text('Signature of Parents/Guardian', 50, sigY + 5, { width: 150 });

      doc.moveTo(400, sigY).lineTo(545, sigY).stroke();
      doc.text('Principal / Director Signature', 400, sigY + 5, { width: 145, align: 'right' });

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

module.exports = { generateReportCard, generateAcademicCalendarPdf, generateAdmissionForm, initBrowser };

