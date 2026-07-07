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
 * Safe date formatter for YYYY-MM-DD strings to DD/MM/YYYY
 * Bypasses local/UTC timezone conversions to prevent day shifting.
 */
function formatLocalDateString(dStr) {
  if (!dStr) return '';
  try {
    const parts = dStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
      }
    }
    const d = new Date(dStr);
    return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('en-IN');
  } catch (e) {
    return dStr;
  }
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

          const formatDateStr = formatLocalDateString;

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

      const BRAND = '#4F46E5';
      const DARK = '#111827';
      const MUTED = '#6B7280';
      const BORDER = '#E5E7EB';
      const LIGHT = '#F9FAFB';

      // --- Helper for drawing lines ---
      const drawLine = (y, color = BORDER) => {
        doc.moveTo(40, y).lineTo(555, y).strokeColor(color).lineWidth(0.5).stroke();
      };

      // --- Helper for drawing sections ---
      const drawSectionHeader = (title, yPos) => {
        doc.y = yPos;
        doc.fillColor(BRAND).fontSize(9).font('Helvetica-Bold').text(title.toUpperCase(), 40, yPos, { characterSpacing: 0.5 });
        doc.moveDown(0.2);
        drawLine(doc.y, BRAND);
        doc.moveDown(0.6);
      };

      // --- Page Border ---
      doc.rect(20, 20, 555, 802).strokeColor(BORDER).lineWidth(0.5).stroke();

      // --- Header ---
      const schoolName = (school.name || 'SCHOOL MANAGEMENT SYSTEM').toUpperCase();
      doc.fillColor(BRAND).fontSize(16).font('Helvetica-Bold').text(schoolName, { align: 'center' });
      doc.fillColor(DARK).fontSize(8.5).font('Helvetica').text(school.address || '', { align: 'center' });
      doc.fillColor(MUTED).text(`${school.phone ? 'Tel: ' + school.phone : ''}${school.email ? ' | Email: ' + school.email : ''}`, { align: 'center' });
      
      doc.moveDown(0.8);
      doc.fillColor(BRAND).fontSize(12).font('Helvetica-Bold').text('ADMISSION FORM REPORT', { align: 'center', characterSpacing: 1.5 });
      doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(`Academic Session: ${session.name || 'N/A'}`, { align: 'center' });
      doc.moveDown(0.8);
      drawLine(doc.y, BRAND);
      doc.moveDown(0.8);

      // --- Photo Box ---
      const photoX = 475;
      const photoY = 110;
      const photoW = 80;
      const photoH = 95;
      
      const { photoBuffer } = data;

      // Draw photo container background and border
      doc.rect(photoX, photoY, photoW, photoH).fillAndStroke(LIGHT, BORDER);

      if (photoBuffer) {
        try {
          doc.image(photoBuffer, photoX + 2, photoY + 2, {
            fit: [photoW - 4, photoH - 4],
            align: 'center',
            valign: 'center'
          });
        } catch (e) {
          console.error('Error drawing student photo buffer on PDF:', e);
          doc.fontSize(8).fillColor(MUTED).text('PHOTO\nERROR', photoX, photoY + 35, { width: photoW, align: 'center' });
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
            doc.fontSize(8).fillColor(MUTED).text('PHOTO\nERROR', photoX, photoY + 35, { width: photoW, align: 'center' });
          }
        } else {
          doc.fontSize(8).fillColor(MUTED).text('PASSPORT\nPHOTO', photoX, photoY + 35, { width: photoW, align: 'center' });
        }
      } else {
        doc.fontSize(8).fillColor(MUTED).text('PASSPORT\nPHOTO', photoX, photoY + 35, { width: photoW, align: 'center' });
      }

      // --- Section: Student Information ---
      drawSectionHeader('1. Student Information', doc.y);
      
      const col1 = 45, col2 = 260;
      let y = doc.y;

      const infoFields = [
        { label: 'Full Name', value: `${student.first_name || ''} ${student.last_name || ''}`.toUpperCase().trim() },
        { label: 'Admission No', value: student.admission_no },
        { label: 'Date of Birth', value: student.date_of_birth ? formatLocalDateString(student.date_of_birth) : 'N/A' },
        { label: 'Gender', value: (student.gender || 'N/A').toUpperCase() },
        { label: 'Aadhaar Card No', value: student.aadhar_no || 'N/A' },
        { label: 'Nationality', value: profile.nationality || 'Indian' },
        { label: 'Religion', value: profile.religion || 'N/A' },
        { label: 'Caste / Category', value: profile.caste || 'N/A' },
        { label: 'Mother Tongue', value: profile.mother_tongue || 'N/A' },
        { label: 'Blood Group', value: profile.blood_group || 'N/A' },
        { label: 'Class & Section', value: `${enrollment.class_name || 'N/A'} - ${enrollment.section_name || 'N/A'}` },
        { label: 'Roll Number', value: enrollment.roll_number || 'N/A' },
        { label: 'Stream', value: (enrollment.stream || 'N/A').toUpperCase() },
        { label: 'Medium', value: profile.medium || 'N/A' },
        { label: 'Joining Type', value: (enrollment.joining_type || 'N/A').toUpperCase() },
        { label: 'Hostel Required', value: profile.is_hostel ? 'YES' : 'NO' },
        { label: 'Distance from School', value: profile.distance_km ? `${profile.distance_km} km` : 'N/A' },
        { label: 'Prev. Year Attendance', value: profile.prev_attendance_days ? `${profile.prev_attendance_days} days` : 'N/A' },
      ];

      doc.fontSize(8.5).fillColor(DARK);
      infoFields.forEach((f, i) => {
        const x = i % 2 === 0 ? col1 : col2;
        const labelWidth = 105;
        doc.fillColor(MUTED).font('Helvetica-Bold').text(`${f.label}:`, x, y, { width: labelWidth });
        doc.fillColor(DARK).font('Helvetica').text(String(f.value || 'N/A'), x + labelWidth, y, { width: 140 });
        if (i % 2 !== 0 || i === infoFields.length - 1) y += 16;
      });

      doc.y = y + 5;
      drawLine(doc.y);
      doc.moveDown(0.6);

      // --- Section: Contact & Address ---
      drawSectionHeader('2. Contact & Address Details', doc.y);
      
      const addrY = doc.y;
      
      // Residential Address
      doc.rect(col1 - 5, addrY, 240, 80).fillAndStroke(LIGHT, BORDER);
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8).text('CURRENT ADDRESS', col1, addrY + 8);
      doc.fillColor(DARK).font('Helvetica').fontSize(8.5).text(profile.address || 'N/A', col1, addrY + 22, { width: 220, height: 28 });
      doc.fillColor(MUTED).fontSize(7.5).text(`P.S: ${profile.police_station || 'N/A'}  ·  P.O: ${profile.post_office || 'N/A'}`, col1, addrY + 54);
      doc.text(`${profile.district || 'N/A'}, ${profile.state || 'N/A'} - ${profile.pincode || 'N/A'}`, col1, addrY + 66);

      // Permanent Address
      doc.rect(col2 - 5, addrY, 240, 80).fillAndStroke(LIGHT, BORDER);
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8).text('PERMANENT ADDRESS', col2, addrY + 8);
      
      const pAddr = profile.is_permanent_same ? profile.address : profile.perm_address;
      const pPS = profile.is_permanent_same ? profile.police_station : profile.perm_police_station;
      const pPO = profile.is_permanent_same ? profile.post_office : profile.perm_post_office;
      const pDist = profile.is_permanent_same ? profile.district : profile.perm_district;
      const pState = profile.is_permanent_same ? profile.state : profile.perm_state;
      const pPin = profile.is_permanent_same ? profile.pincode : profile.perm_pincode;

      if (profile.is_permanent_same) {
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5).text('Same as Current Address', col2, addrY + 34, { width: 220 });
      } else {
        doc.fillColor(DARK).font('Helvetica').fontSize(8.5).text(pAddr || 'N/A', col2, addrY + 22, { width: 220, height: 28 });
        doc.fillColor(MUTED).fontSize(7.5).text(`P.S: ${pPS || 'N/A'}  ·  P.O: ${pPO || 'N/A'}`, col2, addrY + 54);
        doc.text(`${pDist || 'N/A'}, ${pState || 'N/A'} - ${pPin || 'N/A'}`, col2, addrY + 66);
      }

      // Contact Info below Addresses
      doc.y = addrY + 90;
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text('Student Phone:', col1, doc.y);
      doc.fillColor(DARK).font('Helvetica').text(profile.phone || 'N/A', col1 + 80, doc.y);
      doc.fillColor(MUTED).font('Helvetica-Bold').text('Student Email:', col2, doc.y);
      doc.fillColor(DARK).font('Helvetica').text(profile.email || 'N/A', col2 + 80, doc.y);

      doc.y = doc.y + 12;
      drawLine(doc.y);
      doc.moveDown(0.6);

      // --- Section: Parents Info ---
      drawSectionHeader("3. Parents' / Guardian's Profile", doc.y);
      
      const parentTableTop = doc.y;
      const tableHeaderColor = '#eff6ff'; // Light Indigo Tint
      const cellWidth = 128;
      
      // Header BG
      doc.rect(40, parentTableTop, cellWidth * 4, 18).fillAndStroke(tableHeaderColor, BORDER);
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8);
      ['PARTICULAR', 'MOTHER', 'FATHER', 'GUARDIAN'].forEach((h, i) => {
        doc.text(h, 40 + (i * cellWidth), parentTableTop + 5, { width: cellWidth, align: 'center' });
      });

      const parentFields = [
        ['Name', profile.mother_name, profile.father_name, profile.guardian_name],
        ['Qualification', profile.mother_qualification, profile.father_qualification, profile.guardian_qualification],
        ['Mobile No.', profile.mother_phone, profile.father_phone, profile.guardian_phone],
        ['Email', profile.mother_email, profile.parent_email, profile.guardian_email],
        ['Aadhaar No', profile.mother_aadhar, profile.father_aadhar, profile.guardian_aadhar],
        ['Occupation', profile.mother_occupation, profile.father_occupation, profile.guardian_occupation],
        ['Annual Income', profile.mother_annual_income || 'N/A', profile.father_annual_income || 'N/A', 'N/A'],
      ];

      let rowY = parentTableTop + 18;
      doc.fillColor(DARK).font('Helvetica').fontSize(8);
      parentFields.forEach((row) => {
        // Draw Row BG alternating
        row.forEach((cell, i) => {
          doc.rect(40 + (i * cellWidth), rowY, cellWidth, 16).strokeColor(BORDER).stroke();
          doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica');
          doc.fillColor(i === 0 ? BRAND : DARK);
          doc.text(String(cell || 'N/A'), 40 + (i * cellWidth), rowY + 4, { width: cellWidth, align: 'center' });
        });
        rowY += 16;
      });

      doc.y = rowY + 10;

      // --- Section: Academic History ---
      if (academicRecords && academicRecords.length > 0) {
        drawSectionHeader('4. Previous Academic Record', doc.y);
        
        const histTop = doc.y;
        doc.rect(40, histTop, 512, 16).fillAndStroke(LIGHT, BORDER);
        doc.fillColor(BRAND).fontSize(8).font('Helvetica-Bold');
        doc.text('SCHOOL & LOCATION', 45, histTop + 4, { width: 200 });
        doc.text('CLASS', 250, histTop + 4, { width: 50 });
        doc.text('YEAR', 310, histTop + 4, { width: 50 });
        doc.text('PERCENTAGE / GRADE', 370, histTop + 4, { width: 100 });
        
        let ry = histTop + 16;
        doc.fillColor(DARK).font('Helvetica');
        academicRecords.forEach(rec => {
          doc.rect(40, ry, 512, 16).strokeColor(BORDER).stroke();
          doc.text(String(rec.school_name || 'N/A'), 45, ry + 4, { width: 200 });
          doc.text(String(rec.class_name || 'N/A'), 250, ry + 4);
          doc.text(String(rec.year_of_study || 'N/A'), 310, ry + 4);
          doc.text(String(rec.percentage_grade || 'N/A'), 370, ry + 4);
          ry += 16;
        });
        doc.y = ry + 8;
      }

      // --- Section: Declaration ---
      doc.moveDown(0.5);
      drawSectionHeader('4. Declaration', doc.y);
      doc.fontSize(8).font('Helvetica').fillColor(MUTED).text(
        "I hereby declare that the information furnished above is true and correct to the best of my knowledge and belief. I understand that the admission of my ward is subject to the rules and regulations of the school.",
        { align: 'justify', lineGap: 1 }
      );

      // --- Signatures ---
      doc.moveDown(3);
      const sigY = doc.y;
      doc.strokeColor(DARK).lineWidth(0.5);
      
      doc.moveTo(40, sigY).lineTo(160, sigY).stroke();
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(DARK).text('Parent/Guardian Signature', 40, sigY + 4, { width: 120, align: 'center' });

      doc.moveTo(225, sigY).lineTo(345, sigY).stroke();
      doc.text('Clerk/Accountant', 225, sigY + 4, { width: 120, align: 'center' });

      doc.moveTo(410, sigY).lineTo(530, sigY).stroke();
      doc.text('Principal Signature', 410, sigY + 4, { width: 120, align: 'center' });

      // --- Footer ---
      doc.fontSize(7).fillColor(MUTED).text(
        `Generated on ${new Date().toLocaleString('en-IN')} | Educational Management System`,
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

