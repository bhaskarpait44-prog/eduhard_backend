'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

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

      // --- Group Results by Subject ---
      const subjectsMap = {};
      results.forEach(row => {
        const subKey = row.subject_id || row.subject;
        if (!subjectsMap[subKey]) {
          subjectsMap[subKey] = {
            subject_id: row.subject_id,
            subject_name: row.subject,
            subject_code: row.code,
            exams: [],
            weighted_max: 0,
            weighted_obtained: 0,
            weighted_passing: 0,
            is_absent: true,
          };
        }
        const sub = subjectsMap[subKey];
        sub.exams.push(row);

        const weight = parseFloat(row.exam_weightage || 100) / 100;
        sub.weighted_max += parseFloat(row.total_marks || 0) * weight;
        sub.weighted_obtained += (row.is_absent ? 0 : parseFloat(row.marks_obtained || 0)) * weight;
        sub.weighted_passing += parseFloat(row.passing_marks || 0) * weight;

        if (!row.is_absent) {
          sub.is_absent = false;
        }
      });

      // Calculate final weighted grades and status
      const gradingScale = data.gradingScale || [
        { min: 90, grade: 'A+' },
        { min: 80, grade: 'A' },
        { min: 70, grade: 'B+' },
        { min: 60, grade: 'B' },
        { min: 50, grade: 'C' },
        { min: 40, grade: 'D' },
      ];

      const percentageToGrade = (pct, scale) => {
        for (const band of scale) {
          if (pct >= band.min) return band.grade;
        }
        return 'F';
      };

      Object.values(subjectsMap).forEach(sub => {
        const pct = sub.weighted_max > 0 ? parseFloat(((sub.weighted_obtained / sub.weighted_max) * 100).toFixed(2)) : 0.00;
        sub.final_percentage = pct;
        sub.final_grade = percentageToGrade(pct, gradingScale);
        sub.final_is_pass = sub.weighted_obtained >= sub.weighted_passing;
      });

      // --- Results Table ---
      doc.font('Helvetica-Bold').fontSize(12).text('ACADEMIC PERFORMANCE', { underline: true });
      doc.moveDown(0.5);
      
      const tableTop = doc.y;
      const col1 = 50, col2 = 210, col3 = 270, col4 = 320, col5 = 370, col6 = 420, col7 = 475, col8 = 515;
      
      doc.fontSize(10);
      doc.text('Subject / Exam Name', col1, tableTop);
      doc.text('Weightage', col2, tableTop);
      doc.text('Theory', col3, tableTop);
      doc.text('Practical', col4, tableTop);
      doc.text('Total', col5, tableTop);
      doc.text('Obt.', col6, tableTop);
      doc.text('Grade', col7, tableTop);
      doc.text('Status', col8, tableTop);
      
      doc.moveTo(50, tableTop + 15).lineTo(580, tableTop + 15).strokeColor('#333').stroke();
      
      let y = tableTop + 25;

      const drawTableHeaders = (yPos) => {
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Subject / Exam Name', col1, yPos);
        doc.text('Weightage', col2, yPos);
        doc.text('Theory', col3, yPos);
        doc.text('Practical', col4, yPos);
        doc.text('Total', col5, yPos);
        doc.text('Obt.', col6, yPos);
        doc.text('Grade', col7, yPos);
        doc.text('Status', col8, yPos);
        doc.moveTo(50, yPos + 15).lineTo(580, yPos + 15).strokeColor('#333').stroke();
        return yPos + 25;
      };

      Object.values(subjectsMap).forEach(sub => {
        // Calculate needed height for this subject block (Heading + exam rows + final row + spacing)
        const neededHeight = 18 + (sub.exams.length * 16) + 22 + 10;
        if (y + neededHeight > 750) {
          doc.addPage();
          y = 50;
          y = drawTableHeaders(y);
        }

        // Draw Subject Header
        doc.font('Helvetica-Bold').fontSize(10).text(sub.subject_name.toUpperCase(), col1, y);
        y += 18;

        // Draw Exams
        sub.exams.forEach(exam => {
          doc.font('Helvetica').fontSize(9);
          doc.text(exam.exam_name || 'Exam', 65, y);
          doc.text(`${parseFloat(exam.exam_weightage || 100)}%`, col2, y);
          doc.text(exam.theory_marks_obtained !== null ? `${exam.theory_marks_obtained}/${exam.theory_total}` : '-', col3, y);
          doc.text(exam.practical_marks_obtained !== null ? `${exam.practical_marks_obtained}/${exam.practical_total}` : '-', col4, y);
          doc.text(String(exam.total_marks), col5, y);
          doc.text(exam.is_absent ? 'ABSENT' : String(exam.marks_obtained), col6, y);
          doc.text(exam.grade || '-', col7, y);
          doc.text(exam.is_pass ? 'PASS' : 'FAIL', col8, y);
          y += 16;
        });

        // Draw Weighted Total Row
        doc.font('Helvetica-BoldOblique').fontSize(9);
        doc.text('Weighted Total:', 65, y);
        doc.text('100%', col2, y);

        // Compute weighted theory/prac max/obtained for display
        let weightedTheoryMax = 0, weightedTheoryObt = 0, hasTheory = false;
        let weightedPracMax = 0, weightedPracObt = 0, hasPrac = false;
        sub.exams.forEach(e => {
          const w = parseFloat(e.exam_weightage || 100) / 100;
          if (e.theory_total !== null) {
            weightedTheoryMax += parseFloat(e.theory_total) * w;
            weightedTheoryObt += (e.is_absent ? 0 : parseFloat(e.theory_marks_obtained || 0)) * w;
            hasTheory = true;
          }
          if (e.practical_total !== null) {
            weightedPracMax += parseFloat(e.practical_total) * w;
            weightedPracObt += (e.is_absent ? 0 : parseFloat(e.practical_marks_obtained || 0)) * w;
            hasPrac = true;
          }
        });

        doc.text(hasTheory ? `${weightedTheoryObt.toFixed(1)}/${weightedTheoryMax.toFixed(1)}` : '-', col3, y);
        doc.text(hasPrac ? `${weightedPracObt.toFixed(1)}/${weightedPracMax.toFixed(1)}` : '-', col4, y);
        doc.text(sub.weighted_max.toFixed(1), col5, y);
        doc.text(sub.is_absent ? 'ABSENT' : sub.weighted_obtained.toFixed(1), col6, y);
        doc.text(sub.is_absent ? '-' : sub.final_grade, col7, y);
        doc.text(sub.final_is_pass ? 'PASS' : 'FAIL', col8, y);
        
        y += 22;
        // Subtle line between subject blocks
        doc.moveTo(50, y - 6).lineTo(580, y - 6).strokeColor('#eee').stroke();
      });

      doc.y = y;
      doc.moveDown(2);

      // --- Summary ---
      const summaryY = doc.y;
      doc.font('Helvetica-Bold').text('SUMMARY', 50, summaryY);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Aggregate Marks: ${finalResult.marks_obtained} / ${finalResult.total_marks}`, 50, summaryY + 20);
      doc.text(`Percentage: ${finalResult.percentage}%`, 50, summaryY + 35);
      doc.text(`Overall Grade: ${finalResult.grade}`, 50, summaryY + 50);
      doc.text(`Final Result: ${finalResult.result.toUpperCase()}`, 50, summaryY + 65);

      doc.text(`Attendance: ${attendance ? attendance.percentage : 'N/A'}%`, 350, summaryY + 20);
      doc.text(`Days Present: ${attendance ? attendance.effectivePresent + ' / ' + attendance.workingDays : 'N/A'}`, 350, summaryY + 35);

      doc.moveDown(5);

      // --- Signatures ---
      const sigY = doc.y;
      doc.moveTo(50, sigY).lineTo(150, sigY).stroke().strokeColor('#333');
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

      // Sort events by start_date chronologically
      const sortedEvents = [...events].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

      const drawTableHeader = (yPos) => {
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Date', 50, yPos);
        doc.text('Event Title', 150, yPos);
        doc.text('Type', 320, yPos);
        doc.text('Audience', 420, yPos);
        doc.text('Class', 500, yPos);
        doc.moveTo(50, yPos + 15).lineTo(545, yPos + 15).strokeColor('#ccc').stroke();
        return yPos + 25;
      };

      let y = doc.y + 15;
      y = drawTableHeader(y);
      doc.font('Helvetica');

      if (sortedEvents.length === 0) {
        doc.fontSize(10).text('No events scheduled for this period.', 50, y, { align: 'center', width: 495 });
      } else {
        sortedEvents.forEach(event => {
          // Check for page break
          if (y > 740) {
            doc.addPage();
            y = 50;
            y = drawTableHeader(y);
            doc.font('Helvetica');
          }

          const formatDateStr = (dStr) => {
            if (!dStr) return '';
            try {
              const d = new Date(dStr);
              return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('en-IN');
            } catch (e) {
              return dStr;
            }
          };

          const dateStr = event.start_date === event.end_date 
            ? formatDateStr(event.start_date)
            : `${formatDateStr(event.start_date)} to ${formatDateStr(event.end_date)}`;

          doc.fontSize(9);
          doc.text(dateStr, 50, y, { width: 90 });
          doc.text(event.title || 'N/A', 150, y, { width: 160 });
          doc.text((event.event_type || 'N/A').toUpperCase(), 320, y, { width: 90 });
          doc.text((event.audience || 'All').toUpperCase(), 420, y, { width: 70 });
          doc.text(event.target_class_name || 'All', 500, y, { width: 45 });

          y += 35; // Row spacing
        });
      }

      // Draw footer on all pages
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#999').text(
          `Page ${i + 1} of ${pageCount}  |  Generated on ${new Date().toLocaleString()}`,
          50, 780, { align: 'center', width: 495 }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generates an Admission Form PDF summary.
 */
async function generateAdmissionForm(data) {
  const { school = {}, student = {}, profile = {}, enrollment = {}, session = {}, academicRecords = [] } = data;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 40, 
        size: 'A4',
        info: {
          Title: `Admission Form - ${student.admission_no}`,
          Author: school.name || 'School Management System'
        }
      });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // --- Helper for drawing lines ---
      const drawLine = (y, color = '#eee') => {
        doc.moveTo(40, y).lineTo(555, y).strokeColor(color).lineWidth(1).stroke();
      };

      // --- Page Border ---
      doc.rect(20, 20, 555, 802).strokeColor('#2c3e50').lineWidth(1).stroke();

      // --- Header ---
      const schoolName = (school.name || 'SCHOOL MANAGEMENT SYSTEM').toUpperCase();
      doc.fillColor('#1a237e').fontSize(20).font('Helvetica-Bold').text(schoolName, { align: 'center' });
      doc.fillColor('#444').fontSize(9).font('Helvetica').text(school.address || '', { align: 'center' });
      doc.text(`${school.phone ? 'Tel: ' + school.phone : ''}${school.email ? ' | Email: ' + school.email : ''}`, { align: 'center' });
      
      doc.moveDown(1);
      doc.fillColor('#1a237e').fontSize(14).font('Helvetica-Bold').text('ADMISSION FORM', { align: 'center', characterSpacing: 2 });
      doc.fillColor('#666').fontSize(10).font('Helvetica').text(`Academic Session: ${session.name || 'N/A'}`, { align: 'center' });
      doc.moveDown(1);
      drawLine(doc.y, '#1a237e');
      doc.moveDown(1);

      // --- Photo Box ---
      const photoX = 475;
      const photoY = 110;
      const photoW = 80;
      const photoH = 95;
      
      const { photoBuffer } = data;

      doc.rect(photoX, photoY, photoW, photoH).strokeColor('#ccc').stroke();

      if (photoBuffer) {
        try {
          doc.image(photoBuffer, photoX + 2, photoY + 2, {
            fit: [photoW - 4, photoH - 4],
            align: 'center',
            valign: 'center'
          });
        } catch (e) {
          console.error('Error drawing student photo buffer on PDF:', e);
          doc.fontSize(8).fillColor('#999').text('PHOTO\nERROR', photoX, photoY + 35, { width: photoW, align: 'center' });
        }
      } else if (student.photo_path) {
        const fullPath = path.resolve(process.cwd(), student.photo_path);
        if (fs.existsSync(fullPath)) {
          try {
            doc.image(fullPath, photoX + 2, photoY + 2, {
              fit: [photoW - 4, photoH - 4],
              align: 'center',
              valign: 'center'
            });
          } catch (e) {
            console.error('Error drawing student photo path on PDF:', e);
            doc.fontSize(8).fillColor('#999').text('PHOTO\nERROR', photoX, photoY + 35, { width: photoW, align: 'center' });
          }
        } else {
          doc.fontSize(8).fillColor('#999').text('PASSPORT\nPHOTO', photoX, photoY + 35, { width: photoW, align: 'center' });
        }
      } else {
        doc.fontSize(8).fillColor('#999').text('PASSPORT\nPHOTO', photoX, photoY + 35, { width: photoW, align: 'center' });
      }

      // --- Section: Student Information ---
      doc.fillColor('#1a237e').fontSize(11).font('Helvetica-Bold').text('1. STUDENT INFORMATION', 40);
      doc.moveDown(0.5);
      
      const col1 = 45, col2 = 260;
      let y = doc.y;

      const infoFields = [
        { label: 'Full Name', value: `${student.first_name} ${student.last_name}`.toUpperCase() },
        { label: 'Admission No', value: student.admission_no },
        { label: 'Date of Birth', value: student.date_of_birth ? new Date(student.date_of_birth).toLocaleDateString() : 'N/A' },
        { label: 'Gender', value: (student.gender || 'N/A').toUpperCase() },
        { label: 'Aadhar No', value: student.aadhar_no || 'N/A' },
        { label: 'Nationality', value: profile.nationality || 'Indian' },
        { label: 'Religion', value: profile.religion || 'N/A' },
        { label: 'Caste', value: profile.caste || 'N/A' },
        { label: 'Mother Tongue', value: profile.mother_tongue || 'N/A' },
        { label: 'Blood Group', value: profile.blood_group || 'N/A' },
        { label: 'Class Admitted', value: enrollment.class_name || 'N/A' },
        { label: 'Section/Stream', value: `${enrollment.section_name || 'N/A'} / ${enrollment.stream?.toUpperCase() || 'REGULAR'}` },
      ];

      doc.fontSize(10).fillColor('#333');
      infoFields.forEach((f, i) => {
        const x = i % 2 === 0 ? col1 : col2;
        const labelWidth = 100;
        doc.font('Helvetica-Bold').text(`${f.label}:`, x, y, { width: labelWidth });
        doc.font('Helvetica').text(String(f.value || 'N/A'), x + labelWidth, y, { width: 140 });
        if (i % 2 !== 0 || i === infoFields.length - 1) y += 18;
      });

      doc.y = y + 10;
      drawLine(doc.y);
      doc.moveDown(1);

      // --- Section: Contact & Address ---
      doc.fillColor('#1a237e').fontSize(11).font('Helvetica-Bold').text('2. ADDRESS & CONTACT DETAILS');
      doc.moveDown(0.5);
      
      const addrY = doc.y;
      doc.fontSize(9).fillColor('#333');
      
      // Current
      doc.font('Helvetica-Bold').text('RESIDENTIAL ADDRESS', col1, addrY);
      doc.font('Helvetica').text(profile.address || 'N/A', col1, addrY + 15, { width: 200 });
      doc.text(`P.S.: ${profile.police_station || 'N/A'} | P.O.: ${profile.post_office || 'N/A'}`, col1, addrY + 45);
      doc.text(`${profile.district || 'N/A'}, ${profile.state || 'N/A'} - ${profile.pincode || 'N/A'}`, col1, addrY + 58);
      doc.text(`Mobile: ${student.phone || 'N/A'}`, col1, addrY + 71);

      // Permanent
      doc.font('Helvetica-Bold').text('PERMANENT ADDRESS', col2, addrY);
      const pAddr = profile.is_permanent_same ? profile.address : profile.perm_address;
      const pPS = profile.is_permanent_same ? profile.police_station : profile.perm_police_station;
      const pPO = profile.is_permanent_same ? profile.post_office : profile.perm_post_office;
      const pDist = profile.is_permanent_same ? profile.district : profile.perm_district;
      const pState = profile.is_permanent_same ? profile.state : profile.perm_state;
      const pPin = profile.is_permanent_same ? profile.pincode : profile.perm_pincode;

      doc.font('Helvetica').text(pAddr || 'N/A', col2, addrY + 15, { width: 200 });
      doc.text(`P.S.: ${pPS || 'N/A'} | P.O.: ${pPO || 'N/A'}`, col2, addrY + 45);
      doc.text(`${pDist || 'N/A'}, ${pState || 'N/A'} - ${pPin || 'N/A'}`, col2, addrY + 58);

      doc.y = addrY + 90;
      drawLine(doc.y);
      doc.moveDown(1);

      // --- Section: Parents Info ---
      doc.fillColor('#1a237e').fontSize(11).font('Helvetica-Bold').text("3. PARENTS' / GUARDIAN'S PROFILE");
      doc.moveDown(0.5);
      
      const parentTableTop = doc.y;
      const tableHeaderColor = '#f5f5f5';
      const cellWidth = 128;
      
      // Header BG
      doc.rect(40, parentTableTop, cellWidth * 4, 20).fill(tableHeaderColor);
      doc.fillColor('#1a237e').font('Helvetica-Bold').fontSize(9);
      ['PARTICULAR', 'MOTHER', 'FATHER', 'GUARDIAN'].forEach((h, i) => {
        doc.text(h, 40 + (i * cellWidth), parentTableTop + 6, { width: cellWidth, align: 'center' });
      });

      const parentFields = [
        ['Name', profile.mother_name, profile.father_name, profile.guardian_name],
        ['Qualification', profile.mother_qualification, profile.father_qualification, profile.guardian_qualification],
        ['Mobile No.', profile.mother_phone, profile.father_phone, profile.guardian_phone],
        ['Annual Income', '—', profile.father_annual_income, profile.guardian_annual_income],
      ];

      let rowY = parentTableTop + 20;
      doc.fillColor('#333').font('Helvetica').fontSize(9);
      parentFields.forEach((row) => {
        row.forEach((cell, i) => {
          doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica');
          doc.text(String(cell || 'N/A'), 40 + (i * cellWidth), rowY + 6, { width: cellWidth, align: 'center' });
        });
        rowY += 20;
        doc.moveTo(40, rowY).lineTo(552, rowY).strokeColor('#eee').stroke();
      });

      doc.y = rowY + 10;
      doc.moveDown(1);

      // --- Section: Academic History ---
      if (academicRecords && academicRecords.length > 0) {
        doc.fillColor('#1a237e').fontSize(11).font('Helvetica-Bold').text('4. PREVIOUS ACADEMIC RECORD');
        doc.moveDown(0.5);
        
        const histTop = doc.y;
        doc.rect(40, histTop, 512, 18).fill('#f9f9f9');
        doc.fillColor('#1a237e').fontSize(8).font('Helvetica-Bold');
        doc.text('SCHOOL & LOCATION', 45, histTop + 5, { width: 200 });
        doc.text('CLASS', 250, histTop + 5, { width: 50 });
        doc.text('YEAR', 310, histTop + 5, { width: 50 });
        doc.text('PERCENTAGE / GRADE', 370, histTop + 5, { width: 100 });
        
        let ry = histTop + 18;
        doc.fillColor('#333').font('Helvetica');
        academicRecords.forEach(rec => {
          doc.text(String(rec.school_name || 'N/A'), 45, ry + 5, { width: 200 });
          doc.text(String(rec.class_name || 'N/A'), 250, ry + 5);
          doc.text(String(rec.year_of_study || 'N/A'), 310, ry + 5);
          doc.text(String(rec.percentage_grade || 'N/A'), 370, ry + 5);
          ry += 18;
          doc.moveTo(40, ry).lineTo(552, ry).strokeColor('#eee').stroke();
        });
        doc.y = ry + 10;
      }

      // --- Section: Declaration ---
      doc.moveDown(1);
      doc.fillColor('#1a237e').fontSize(11).font('Helvetica-Bold').text('5. DECLARATION');
      doc.fontSize(8.5).font('Helvetica').fillColor('#555').text(
        "I hereby declare that the information furnished above is true and correct to the best of my knowledge and belief. I understand that the admission of my ward is subject to the rules and regulations of the school.",
        { align: 'justify', lineGap: 2 }
      );

      // --- Signatures ---
      doc.moveDown(4);
      const sigY = doc.y;
      doc.strokeColor('#2c3e50').lineWidth(0.5);
      
      doc.moveTo(40, sigY).lineTo(160, sigY).stroke();
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text('Parent/Guardian Signature', 40, sigY + 5, { width: 120, align: 'center' });

      doc.moveTo(225, sigY).lineTo(345, sigY).stroke();
      doc.text('Clerk/Accountant', 225, sigY + 5, { width: 120, align: 'center' });

      doc.moveTo(410, sigY).lineTo(530, sigY).stroke();
      doc.text('Principal Signature', 410, sigY + 5, { width: 120, align: 'center' });

      // --- Footer ---
      doc.fontSize(7).fillColor('#999').text(
        `Generated on ${new Date().toLocaleString()} | Educational Management System`,
        20, 810, { align: 'center', width: 555 }
      );

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

