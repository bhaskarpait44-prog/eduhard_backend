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
      doc.text(`Date of Birth: ${student.date_of_birth ? formatLocalDateString(student.date_of_birth) : 'N/A'}`, 50, startY + 60);

      doc.text(`Class: ${enrollment.class_name}`, 350, startY);
      doc.text(`Section: ${enrollment.section_name || 'N/A'}`, 350, startY + 20);
      doc.text(`Father's Name: ${student.father_name || 'N/A'}`, 350, startY + 40);
      
      doc.y = startY + 85;

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

          const tTotal = exam.theory_total ? parseFloat(exam.theory_total) : 0;
          const pTotal = exam.practical_total ? parseFloat(exam.practical_total) : 0;
          
          // Theory Column display
          let tText = '-';
          if (tTotal > 0) {
            if (exam.is_absent) tText = 'ABS';
            else if (tTotal > 0 && pTotal > 0) tText = exam.theory_marks_obtained !== null ? `${exam.theory_marks_obtained}/${exam.theory_total}` : '-';
            else tText = exam.marks_obtained !== null ? `${exam.marks_obtained}/${exam.theory_total}` : '-';
          }
          doc.text(tText, col3, y);

          // Practical Column display
          let pText = '-';
          if (pTotal > 0) {
            if (exam.is_absent) pText = 'ABS';
            else if (tTotal > 0 && pTotal > 0) pText = exam.practical_marks_obtained !== null ? `${exam.practical_marks_obtained}/${exam.practical_total}` : '-';
            else pText = exam.marks_obtained !== null ? `${exam.marks_obtained}/${exam.practical_total}` : '-';
          }
          doc.text(pText, col4, y);

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
          const tTotal = e.theory_total ? parseFloat(e.theory_total) : 0;
          const pTotal = e.practical_total ? parseFloat(e.practical_total) : 0;
          
          if (tTotal > 0) {
            weightedTheoryMax += tTotal * w;
            const obt = (tTotal > 0 && pTotal > 0) ? (e.theory_marks_obtained || 0) : (e.marks_obtained || 0);
            weightedTheoryObt += (e.is_absent ? 0 : parseFloat(obt)) * w;
            hasTheory = true;
          }
          if (pTotal > 0) {
            weightedPracMax += pTotal * w;
            const obt = (tTotal > 0 && pTotal > 0) ? (e.practical_marks_obtained || 0) : (e.marks_obtained || 0);
            weightedPracObt += (e.is_absent ? 0 : parseFloat(obt)) * w;
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

      doc.moveDown(2);

      // --- Remarks ---
      doc.font('Helvetica-Bold').fontSize(10).text("Class Teacher's Remarks:", 50, doc.y);
      doc.font('Helvetica').fontSize(9).text(data.remarks || 'No remarks provided.', 50, doc.y + 15, { width: 495 });
      doc.moveDown(4);

      doc.end();
    } catch (err) { reject(err); }
  });
}

/**
/**
 * Helper to get custom category styling matching the Greenfield design
 */
function getGreenfieldCategory(ev) {
  const type = ev.event_type;
  const title = (ev.title || '').toLowerCase();
  
  if (type === 'exam' || type === 'result') {
    return { name: 'Examination', color: '#e67e22', bg: '#fef5ec', icon: 'exam' };
  }
  if (type === 'meeting') {
    return { name: 'PTM', color: '#9b59b6', bg: '#fbf5fc', icon: 'ptm' };
  }
  if (title.includes('vacation') || title.includes('break') || title.includes('holidays')) {
    return { name: 'Vacation', color: '#2980b9', bg: '#eef6fa', icon: 'vacation' };
  }
  if (title.includes('republic') || title.includes('independence') || title.includes('gandhi') || title.includes('working day')) {
    if (title.includes('working day')) {
      return { name: 'Academic', color: '#27ae60', bg: '#eef9f1', icon: 'academic' };
    }
    return { name: 'National Holiday', color: '#e74c3c', bg: '#fdedec', icon: 'national' };
  }
  if (type === 'holiday') {
    return { name: 'Holiday', color: '#e91e63', bg: '#fdf0f5', icon: 'holiday' };
  }
  if (type === 'sports' || type === 'cultural' || title.includes('celebration') || title.includes('day')) {
    return { name: 'Celebration', color: '#f1c40f', bg: '#fefced', icon: 'celebration' };
  }
  return { name: 'Academic', color: '#27ae60', bg: '#eef9f1', icon: 'academic' };
}

/**
 * Draws the Greenfield layout header on a PDF page
 */
function drawGreenfieldHeader(doc, school, session, subTitleText = 'LIST VIEW') {
  const navy = '#0a1c3f';
  const gold = '#d97706';
  const gray = '#4b5563';

  // 1. Draw circular crest / logo (Left)
  const cx = 35, cy = 25;
  doc.circle(cx + 25, cy + 25, 25).fill(navy);
  doc.circle(cx + 25, cy + 25, 23).strokeColor(gold).lineWidth(1.5).stroke();
  
  // Graduation/book cap icon inside logo
  doc.fillColor('#ffffff');
  doc.polygon([cx + 15, cy + 23], [cx + 25, cy + 18], [cx + 35, cy + 23], [cx + 25, cy + 28]).fill();
  doc.rect(cx + 21, cy + 26, 8, 5).fill();
  doc.moveTo(cx + 31, cy + 23).lineTo(cx + 31, cy + 31).strokeColor('#ffffff').lineWidth(1).stroke();
  doc.circle(cx + 31, cy + 31, 1.5).fill('#ffffff');

  // Center Title block
  const rawSchoolName = (school.name || 'GREENFIELD INTERNATIONAL SCHOOL').toUpperCase();
  const schoolAddress = school.address || '';
  
  // 1. School name (top, large, bold)
  const schoolFontSize = rawSchoolName.length > 28 ? 12 : rawSchoolName.length > 20 ? 13 : 14;
  doc.fillColor(navy).fontSize(schoolFontSize).font('Helvetica-Bold').text(rawSchoolName, 100, cy + 1, { align: 'center', width: 385 });
  
  // 2. School address (below school name)
  if (schoolAddress) {
    doc.fillColor(gray).fontSize(7.5).font('Helvetica').text(schoolAddress, 100, cy + 16, { align: 'center', width: 385, height: 10, ellipsis: true });
  }
  
  // 3. ACADEMIC CALENDAR (slightly smaller than school name, below address)
  doc.fillColor(navy).fontSize(10.5).font('Helvetica-Bold').text('ACADEMIC CALENDAR', 100, cy + 28, { align: 'center', width: 385 });
  
  // Gold divider
  doc.moveTo(220, cy + 42).lineTo(360, cy + 42).strokeColor(gold).lineWidth(1).stroke();
  
  // Banner curved badge
  doc.roundedRect(230, cy + 46, 105, 14, 7).fill(navy);
  doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold').text(subTitleText, 230, cy + 49.5, { align: 'center', width: 105 });

  // 3. Right Calendar shield badge
  const bx = 495, by = 20;
  doc.roundedRect(bx, by, 65, 55, 6).fill(navy);
  
  // Calendar icon on right badge
  doc.strokeColor('#ffffff').lineWidth(0.8);
  doc.rect(bx + 26, by + 6, 12, 10).stroke();
  doc.moveTo(bx + 26, by + 9).lineTo(bx + 38, by + 9).stroke();
  doc.circle(bx + 29, by + 12, 0.6).fill('#ffffff');
  doc.circle(bx + 32, by + 12, 0.6).fill('#ffffff');
  doc.circle(bx + 35, by + 12, 0.6).fill('#ffffff');

  doc.fillColor('#ffffff').fontSize(6).font('Helvetica-Bold').text('ACADEMIC', bx, by + 21, { align: 'center', width: 65 });
  doc.text('YEAR', bx, by + 28, { align: 'center', width: 65 });
  doc.moveTo(bx + 15, by + 37).lineTo(bx + 50, by + 37).strokeColor('#ffffff').lineWidth(0.5).stroke();
  doc.fontSize(7.5).text(session.name || '2025-2026', bx, by + 41.5, { align: 'center', width: 65 });
}

/**
 * Draw tiny icons next to month names
 */
function drawMonthIcon(doc, monthName, x, y) {
  doc.fillColor('#ffffff').strokeColor('#ffffff').lineWidth(0.8);
  const m = monthName.toLowerCase();
  
  if (m === 'april') {
    // Leaf icon
    doc.moveTo(x + 3, y + 7).bezierCurveTo(x + 7, y + 2, x + 10, y + 5, x + 8, y + 8).lineTo(x + 3, y + 7).fill();
  } else if (m === 'may') {
    // Sun icon
    doc.circle(x + 6, y + 5, 2.5).fill();
  } else if (m === 'june' || m === 'february') {
    // Book icon
    doc.polygon([x + 2, y + 3], [x + 5, y + 2], [x + 8, y + 3], [x + 8, y + 8], [x + 5, y + 7], [x + 2, y + 8]).fill();
  } else if (m === 'july') {
    // Pencil icon
    doc.rect(x + 3, y + 3, 4, 3).fill();
    doc.polygon([x + 3, y + 6], [x + 5, y + 8], [x + 7, y + 6]).fill();
  } else if (m === 'august' || m === 'january') {
    // Flag icon
    doc.moveTo(x + 3, y + 2).lineTo(x + 3, y + 8).stroke();
    doc.rect(x + 3, y + 2, 5, 3).fill();
  } else if (m === 'september') {
    // Profile/Hat icon
    doc.circle(x + 5, y + 4, 1.5).fill();
    doc.rect(x + 2, y + 6, 6, 2).fill();
  } else if (m === 'december') {
    // Snowflake icon
    doc.circle(x + 5, y + 5, 1.2).fill();
  } else {
    // Generic dot icon
    doc.circle(x + 5, y + 5, 1.5).fill();
  }
}

/**
 * Draw tiny icons next to category tags
 */
function drawCategoryIcon(doc, catIcon, x, y, color) {
  doc.fillColor(color).strokeColor(color).lineWidth(0.8);
  
  if (catIcon === 'academic') {
    // Graduation cap
    doc.polygon([x + 2, y + 5], [x + 6, y + 2], [x + 10, y + 5], [x + 6, y + 8]).fill();
    doc.rect(x + 4, y + 6, 4, 2.5).fill();
  } else if (catIcon === 'exam') {
    // Clipboard
    doc.rect(x + 3, y + 3, 5, 6).stroke();
    doc.rect(x + 4, y + 2, 3, 1.5).fill();
  } else if (catIcon === 'ptm') {
    // Group / double dots
    doc.circle(x + 4, y + 5, 1.5).fill();
    doc.circle(x + 8, y + 5, 1.5).fill();
  } else if (catIcon === 'vacation') {
    // Suitcase
    doc.rect(x + 3, y + 4, 6, 5, 1).fill();
    doc.rect(x + 4, y + 2, 4, 2).stroke();
  } else if (catIcon === 'national') {
    // Flag
    doc.moveTo(x + 3, y + 2).lineTo(x + 3, y + 8).stroke();
    doc.polygon([x + 3, y + 2], [x + 8, y + 4], [x + 3, y + 6]).fill();
  } else if (catIcon === 'celebration') {
    // Star
    doc.polygon([x + 6, y + 2], [x + 8, y + 5], [x + 11, y + 5], [x + 9, y + 7], [x + 10, y + 10], [x + 6, y + 8], [x + 2, y + 10], [x + 3, y + 7], [x + 1, y + 5], [x + 4, y + 5]).fill();
  } else {
    // Holiday/Sun
    doc.circle(x + 6, y + 5, 2).fill();
  }
}

/**
 * Draws the Greenfield layout bottom footer on the last page of the PDF
 */
function drawGreenfieldFooter(doc, startY) {
  const navy = '#0a1c3f';
  const textColor = '#333333';

  // 1. Draw Category Legend Box
  doc.roundedRect(30, startY, 90, 14, 7).fill(navy);
  doc.fillColor('#ffffff').fontSize(6.5).font('Helvetica-Bold').text('CATEGORY LEGEND', 30, startY + 4, { align: 'center', width: 90 });

  const legendItems = [
    { label: 'Academic', color: '#27ae60' },
    { label: 'Examination', color: '#e67e22' },
    { label: 'Holiday', color: '#e91e63' },
    { label: 'Vacation', color: '#2980b9' },
    { label: 'PTM', color: '#9b59b6' },
    { label: 'Celebration', color: '#f1c40f' },
    { label: 'National Holiday', color: '#e74c3c' }
  ];

  let legX = 130;
  legendItems.forEach(item => {
    // draw small square
    doc.rect(legX, startY + 4, 5, 5).fill(item.color);
    doc.fillColor(textColor).fontSize(6.5).font('Helvetica-Bold').text(item.label, legX + 9, startY + 3.5);
    legX += (item.label.length * 4.2) + 20;
  });

  // Divider line
  doc.moveTo(30, startY + 22).lineTo(565, startY + 22).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

  // 2. Note Box (Left)
  const boxY = startY + 29;
  doc.fillColor(navy).fontSize(8).font('Helvetica-Bold').text('NOTE:', 30, boxY);
  
  doc.fillColor('#555555').fontSize(6.5).font('Helvetica');
  doc.text('• The above dates are tentative and subject to change.', 30, boxY + 12, { lineGap: 1.5 });
  doc.text('• Any changes will be informed through school app / website.', 30, boxY + 22, { lineGap: 1.5 });
  doc.text('• Parents are requested to check the school communication regularly.', 30, boxY + 32, { lineGap: 1.5 });

  // Divider vertical
  doc.moveTo(275, boxY).lineTo(275, boxY + 40).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

  // 3. Quote Bubble (Right)
  const qx = 290, qy = boxY;
  
  // Quote Circle bubble background
  doc.circle(qx + 15, qy + 18, 12).fill('#f0fdf4');
  doc.fillColor('#166534').fontSize(14).font('Helvetica-BoldOblique').text('“', qx + 8, qy + 12);
  
  // Quote text
  doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Oblique').text('‘Education is the passport to the future, for tomorrow belongs to those who prepare for it today.’', qx + 35, qy + 8, { width: 235, lineGap: 2 });
  doc.fillColor('#4b5563').fontSize(6).font('Helvetica-Bold').text('– Malcolm X', qx + 35, qy + 32, { align: 'right', width: 200 });
}

/**
 * Draws the contact details footer bar at the bottom of every page
 */
function drawGreenfieldContactBar(doc, school) {
  // Temporarily disable margins to avoid auto page breaks at Y > 812
  const oldMargins = doc.page.margins;
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  
  const navy = '#0a1c3f';
  
  // Full width bar at the bottom
  doc.rect(0, 812, 595, 30).fill(navy);
  
  // Draw contact details
  doc.fillColor('#ffffff').fontSize(6.5).font('Helvetica-Bold');
  
  const address = school.address || '123, Greenfield Avenue, Knowledge Park, City - 400001';
  const phone = school.phone || '+91 98765 43210';
  const website = school.website || 'www.greenfieldschool.edu.in';
  const email = school.email || 'info@greenfieldschool.edu.in';

  // Draw circular icon background representations
  // 1. Address
  doc.circle(30, 827, 3.5).fill('#1e3a8a');
  doc.fillColor('#ffffff').text(address, 38, 824);
  
  // 2. Phone
  doc.circle(260, 827, 3.5).fill('#1e3a8a');
  doc.fillColor('#ffffff').text(phone, 268, 824);

  // 3. Website
  doc.circle(360, 827, 3.5).fill('#1e3a8a');
  doc.fillColor('#ffffff').text(website, 368, 824);

  // 4. Email
  doc.circle(480, 827, 3.5).fill('#1e3a8a');
  doc.fillColor('#ffffff').text(email, 488, 824);

  // Restore margins
  doc.page.margins = oldMargins;
}

/**
 * Draws a mini month grid box for the 12-month calendar page in Greenfield styling
 */
function drawGreenfieldMonthGrid(doc, year, month, x, y, width, height, eventsMap, monthColor) {
  const startDay = new Date(year, month, 1).getDay(); // 0 = Sun, 1 = Mon...
  const startDayOfWeek = startDay === 0 ? 6 : startDay - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();

  // Month header bar
  doc.rect(x, y, width, 14).fill(monthColor);
  doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' }).toUpperCase();
  doc.text(`${monthName} ${year}`, x, y + 3.5, { align: 'center', width });

  // Weekdays
  doc.fillColor('#555555').fontSize(5.5).font('Helvetica-Bold');
  const colWidth = width / 7;
  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  weekdays.forEach((day, i) => {
    doc.text(day, x + (i * colWidth), y + 17, { align: 'center', width: colWidth });
  });

  // Draw day numbers
  let currentDay = 1;
  let row = 0;
  const rowHeight = (height - 24) / 6;

  while (currentDay <= totalDays) {
    for (let col = 0; col < 7; col++) {
      if ((row === 0 && col < startDayOfWeek) || currentDay > totalDays) {
        continue;
      }

      const dayX = x + (col * colWidth);
      const dayY = y + 26 + (row * rowHeight);
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
      const dayEvents = eventsMap[dateKey] || [];

      if (dayEvents.length > 0) {
        const category = getGreenfieldCategory(dayEvents[0]);
        doc.circle(dayX + colWidth / 2, dayY + 5, 6).fill(category.color);
        doc.fillColor('#ffffff').fontSize(6).font('Helvetica-Bold');
      } else {
        if (col === 6) {
          doc.fillColor('#dc2626'); // Sunday red
        } else {
          doc.fillColor('#333333');
        }
        doc.fontSize(6).font('Helvetica');
      }

      doc.text(String(currentDay), dayX, dayY + 1.5, { align: 'center', width: colWidth });
      currentDay++;
    }
    row++;
  }
}

/**
 * Draws a detailed monthly calendar spanning a larger section of the page in Greenfield styling
 */
function drawGreenfieldLargeMonth(doc, year, month, startY, eventsMap) {
  const navy = '#0a1c3f';
  const startDay = new Date(year, month, 1).getDay();
  const startDayOfWeek = startDay === 0 ? 6 : startDay - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();

  const width = 535;
  const height = 350;
  const x = 30;
  const y = startY;

  // Month Title Bar
  doc.rect(x, y, width, 24).fill(navy);
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold');
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' }).toUpperCase();
  doc.text(`${monthName} ${year}`, x, y + 6.5, { align: 'center', width });

  // Weekdays Row
  doc.fillColor('#374151').fontSize(8.5).font('Helvetica-Bold');
  const colWidth = width / 7;
  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  weekdays.forEach((day, i) => {
    doc.text(day, x + (i * colWidth), y + 32, { align: 'center', width: colWidth });
  });

  // Draw day cells
  let currentDay = 1;
  let row = 0;
  const cellHeight = (height - 44) / 6;

  doc.lineWidth(0.5).strokeColor('#d1d5db');

  while (currentDay <= totalDays) {
    for (let col = 0; col < 7; col++) {
      const cellX = x + (col * colWidth);
      const cellY = y + 44 + (row * cellHeight);
      doc.rect(cellX, cellY, colWidth, cellHeight).stroke();

      if ((row === 0 && col < startDayOfWeek) || currentDay > totalDays) {
        continue;
      }

      if (col === 6) {
        doc.fillColor('#dc2626');
      } else {
        doc.fillColor('#1f2937');
      }
      doc.fontSize(8.5).font('Helvetica-Bold');
      doc.text(String(currentDay), cellX, cellY + 4, { align: 'right', width: colWidth - 6 });

      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
      const dayEvents = eventsMap[dateKey] || [];

      let eventY = cellY + 16;
      dayEvents.slice(0, 3).forEach(ev => {
        const category = getGreenfieldCategory(ev);
        // Draw miniature event capsule bar
        doc.roundedRect(cellX + 2, eventY, colWidth - 4, 10, 2).fill(category.color);
        doc.fillColor('#ffffff').fontSize(5.5).font('Helvetica-Bold');
        doc.text(ev.title, cellX + 4, eventY + 1.5, { width: colWidth - 8, height: 8, ellipsis: true });
        eventY += 11;
      });

      currentDay++;
    }
    row++;
  }
}

/**
 * Draws a clean, paginated table of academic calendar events in Greenfield styling
 */
function drawGreenfieldEventsTable(doc, events, tableX, startY, school, session, drawHeader = false, subTitleText = 'LIST VIEW') {
  let tableY = startY;
  
  const drawTableHeaderBar = (y) => {
    doc.rect(tableX, y, 535, 18, 3).fill('#0a1c3f');
    doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
    
    doc.text('MONTH', tableX + 8, y + 5.5);
    doc.text('DATE / DURATION', tableX + 85, y + 5.5);
    doc.text('EVENT', tableX + 195, y + 5.5);
    doc.text('CATEGORY', tableX + 335, y + 5.5);
    doc.text('REMARKS', tableX + 440, y + 5.5);
    return y + 18;
  };

  tableY = drawTableHeaderBar(tableY);

  const monthColors = {
    'april': '#4caf50',
    'may': '#ffc107',
    'june': '#009688',
    'july': '#00bcd4',
    'august': '#3f51b5',
    'september': '#9c27b0',
    'october': '#ff5722',
    'november': '#e91e63',
    'december': '#607d8b',
    'january': '#2196f3',
    'february': '#673ab7',
    'march': '#4caf50'
  };

  const sortedEvents = [...events].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
  let isAltRow = false;

  sortedEvents.forEach((ev) => {
    const rowHeight = 28;
    if (tableY + rowHeight > 730) {
      doc.addPage();
      if (drawHeader) {
        drawGreenfieldHeader(doc, school, session, subTitleText);
      }
      tableY = 95;
      tableY = drawTableHeaderBar(tableY);
    }

    const cellY = tableY;

    if (isAltRow) {
      doc.rect(tableX, cellY, 535, rowHeight).fill('#fafafa');
    }
    isAltRow = !isAltRow;

    // 1. Month badge Column
    const startDate = new Date(ev.start_date);
    const monthName = startDate.toLocaleString('en-US', { month: 'long' });
    const monthKey = monthName.toLowerCase();
    const mColor = monthColors[monthKey] || '#607d8b';

    doc.roundedRect(tableX + 4, cellY + 6, 72, 16, 3).fill(mColor);
    drawMonthIcon(doc, monthName, tableX + 8, cellY + 9);
    doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold').text(monthName.toUpperCase(), tableX + 18, cellY + 10.5, { align: 'center', width: 54 });

    // 2. Date column
    const dateText = ev.start_date === ev.end_date 
      ? formatLocalDateString(ev.start_date)
      : `${formatLocalDateString(ev.start_date)} – ${formatLocalDateString(ev.end_date)}`;
    
    doc.fillColor('#0a1c3f').fontSize(8).font('Helvetica-Bold').text(dateText, tableX + 85, cellY + 10.5);

    // 3. Event Column
    doc.fillColor('#000000').fontSize(8.5).font('Helvetica-Bold').text(ev.title, tableX + 195, cellY + 10.5, { width: 135, height: 18, ellipsis: true });

    // 4. Category Badges
    const category = getGreenfieldCategory(ev);
    doc.roundedRect(tableX + 335, cellY + 7, 95, 14, 7).fill(category.bg);
    doc.roundedRect(tableX + 335, cellY + 7, 95, 14, 7).strokeColor(category.color).lineWidth(0.5).stroke();
    drawCategoryIcon(doc, category.icon, tableX + 341, cellY + 9, category.color);
    doc.fillColor(category.color).fontSize(7).font('Helvetica-Bold').text(category.name, tableX + 351, cellY + 10.5, { align: 'center', width: 75 });

    // 5. Remarks Column with Target Audience / Class Info
    let remarkText = '';
    if (ev.audience && ev.audience !== 'everyone') {
      const target = ev.target_class_name ? `Class ${ev.target_class_name}` : ev.audience;
      remarkText = `[For ${target}] `;
    }
    remarkText += ev.description || 'Academic activity scheduled';

    doc.fillColor('#555555').fontSize(7.5).font('Helvetica').text(remarkText, tableX + 440, cellY + 10.5, { width: 90, height: 18, ellipsis: true });

    doc.moveTo(tableX, cellY + rowHeight).lineTo(tableX + 535, cellY + rowHeight).strokeColor('#eef2f5').lineWidth(0.5).stroke();
    tableY += rowHeight;
  });

  return tableY;
}

/**
 * Generates an Academic Calendar PDF using PDFKit.
 */
async function generateAcademicCalendarPdf(data) {
  const { school = {}, session = {}, events = [], viewType = 'calendar', selectedMonth, selectedYear } = data;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4', bufferPages: true });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // Create UTC-safe events map for highlighting calendar days
      const eventsMap = {};
      events.forEach(event => {
        try {
          const partsStart = event.start_date.split('-');
          const partsEnd = (event.end_date || event.start_date).split('-');
          if (partsStart.length === 3 && partsEnd.length === 3) {
            const sy = parseInt(partsStart[0], 10);
            const sm = parseInt(partsStart[1], 10) - 1;
            const sd = parseInt(partsStart[2], 10);
            
            const ey = parseInt(partsEnd[0], 10);
            const em = parseInt(partsEnd[1], 10) - 1;
            const ed = parseInt(partsEnd[2], 10);

            const start = new Date(Date.UTC(sy, sm, sd));
            const end = new Date(Date.UTC(ey, em, ed));
            const curr = new Date(start);
            
            while (curr <= end) {
              const dateKey = curr.toISOString().split('T')[0];
              if (!eventsMap[dateKey]) eventsMap[dateKey] = [];
              eventsMap[dateKey].push(event);
              curr.setUTCDate(curr.getUTCDate() + 1);
            }
          }
        } catch (e) {
          console.error('[CalendarPdf] Event date parsing error:', e.message);
        }
      });

      if (viewType === 'calendar') {
        // --- CALENDAR GRID VIEW ---
        drawGreenfieldHeader(doc, school, session, 'CALENDAR VIEW');

        if (selectedMonth && selectedYear) {
          // Render single large month calendar view
          const year = parseInt(selectedYear, 10);
          const month = parseInt(selectedMonth, 10) - 1; // 0-indexed
          drawGreenfieldLargeMonth(doc, year, month, 95, eventsMap);
          drawGreenfieldFooter(doc, 460);

          // --- EVENT SCHEDULE APPENDIX (Holidays Only) ---
          const holidaysOnly = events.filter(e => e.event_type === 'holiday');
          doc.addPage();
          drawGreenfieldHeader(doc, school, session, 'HOLIDAYS LIST');
          
          // Print Appendix title
          doc.fillColor('#0a1c3f').fontSize(10).font('Helvetica-Bold').text('HOLIDAYS LIST', 30, 95);
          doc.moveTo(30, 109).lineTo(565, 109).strokeColor('#d97706').lineWidth(1).stroke();
          
          if (holidaysOnly.length > 0) {
            drawGreenfieldEventsTable(doc, holidaysOnly, 30, 120, school, session, true, 'HOLIDAYS LIST');
          } else {
            doc.fillColor('#555555').fontSize(9).font('Helvetica-Oblique').text('No holidays scheduled for this period.', 30, 130);
          }
          drawGreenfieldFooter(doc, 735);
        } else {
          // Render full 12-month grid view starting from session start_date month
          const startParts = (session.start_date || '2025-04-01').split('-');
          const startYear = parseInt(startParts[0], 10) || 2025;
          const startMonth = (parseInt(startParts[1], 10) || 4) - 1;

          const gridStartX = 30;
          const gridStartY = 95;
          const colWidth = 165;
          const colSpacing = 20;
          const rowHeight = 85;
          const rowSpacing = 12;

          const monthColors = [
            '#4caf50', '#ffc107', '#009688', '#00bcd4',
            '#3f51b5', '#9c27b0', '#ff5722', '#e91e63',
            '#607d8b', '#2196f3', '#673ab7', '#4caf50'
          ];

          for (let i = 0; i < 12; i++) {
            const m = (startMonth + i) % 12;
            const y = startYear + Math.floor((startMonth + i) / 12);
            
            const colIndex = i % 3;
            const rowIndex = Math.floor(i / 3);
            const x = gridStartX + colIndex * (colWidth + colSpacing);
            const yPos = gridStartY + rowIndex * (rowHeight + rowSpacing);
            const monthColor = monthColors[i % monthColors.length];

            drawGreenfieldMonthGrid(doc, y, m, x, yPos, colWidth, rowHeight, eventsMap, monthColor);
          }

          // Draw bottom legend & widgets
          drawGreenfieldFooter(doc, 490);

          // --- EVENT SCHEDULE APPENDIX (Holidays Only) ---
          const holidaysOnly = events.filter(e => e.event_type === 'holiday');
          doc.addPage();
          drawGreenfieldHeader(doc, school, session, 'HOLIDAYS LIST');
          
          // Print Appendix title
          doc.fillColor('#0a1c3f').fontSize(10).font('Helvetica-Bold').text('HOLIDAYS LIST', 30, 95);
          doc.moveTo(30, 109).lineTo(565, 109).strokeColor('#d97706').lineWidth(1).stroke();
          
          if (holidaysOnly.length > 0) {
            drawGreenfieldEventsTable(doc, holidaysOnly, 30, 120, school, session, true, 'HOLIDAYS LIST');
          } else {
            doc.fillColor('#555555').fontSize(9).font('Helvetica-Oblique').text('No holidays scheduled for this period.', 30, 130);
          }
          drawGreenfieldFooter(doc, 735);
        }
      } else {
        // --- LIST VIEW TABLE ---
        drawGreenfieldHeader(doc, school, session, 'LIST VIEW');
        drawGreenfieldEventsTable(doc, events, 30, 95, school, session, true, 'LIST VIEW');
        drawGreenfieldFooter(doc, 735);
      }

      // Draw page numbers and bottom contact bar on all pages
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        
        // Temporarily disable margins for safety to prevent auto page breaks
        const oldMargins = doc.page.margins;
        doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
        
        drawGreenfieldContactBar(doc, school);
        
        doc.fillColor('#999999').fontSize(7).font('Helvetica').text(
          `Page ${i + 1} of ${pageCount}`,
          30, 804, { align: 'right', width: 535 }
        );
        
        doc.page.margins = oldMargins;
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

