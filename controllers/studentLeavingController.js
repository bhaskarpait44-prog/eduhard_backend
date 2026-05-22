'use strict';

const sequelize = require('../config/database');
const { renderPdf } = require('../utils/puppeteerPdf');

exports.downloadLeftStudentsPdf = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { 
      search = '', 
      leaving_reason = '', 
      class_id = '', 
      session_id = '',
      from_date = '',
      to_date = ''
    } = req.query;

    const replacements = { 
      schoolId, 
      search: `%${search}%`,
      leaving_reason: leaving_reason || null,
      classId: class_id ? parseInt(class_id, 10) : null,
      sessionId: session_id ? parseInt(session_id, 10) : null,
      fromDate: from_date || null,
      toDate: to_date || null
    };

    const [[school]] = await sequelize.query(`
      SELECT name, branch_name, address, phone, email FROM schools WHERE id = :schoolId LIMIT 1
    `, { replacements: { schoolId } });

    if (!school) {
      console.warn(`[PDF Export] School with ID ${schoolId} not found. Using default values.`);
    }

    const schoolData = school || { name: 'Institution', branch_name: '', address: '', phone: '', email: '' };

    const [students] = await sequelize.query(`
      SELECT DISTINCT ON (s.id)
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url, 
        s.left_date, s.leaving_reason, s.leaving_remarks,
        c.name AS class_name, sec.name AS section_name, sess.name AS session_name
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.leaving_type = 'left'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN sessions sess ON sess.id = e.session_id
      WHERE s.school_id = :schoolId 
        AND s.status = 'left'
        AND s.is_deleted = false
        AND (s.first_name ILIKE :search OR s.last_name ILIKE :search OR s.admission_no ILIKE :search)
        AND (:leaving_reason IS NULL OR s.leaving_reason = :leaving_reason)
        AND (:classId IS NULL OR e.class_id = :classId)
        AND (:sessionId IS NULL OR e.session_id = :sessionId)
        AND (:fromDate IS NULL OR s.left_date >= CAST(:fromDate AS DATE))
        AND (:toDate IS NULL OR s.left_date <= CAST(:toDate AS DATE))
      ORDER BY s.id, e.left_date DESC
    `, { replacements });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary:    #1e40af;
      --primary-lt: #dbeafe;
      --danger:     #dc2626;
      --danger-lt:  #fee2e2;
      --text:       #0f172a;
      --muted:      #64748b;
      --border:     #e2e8f0;
      --surface:    #f8fafc;
      --white:      #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      margin: 0;
      padding: 0;
      color: var(--text);
      background: var(--white);
      -webkit-print-color-adjust: exact;
    }
    .header {
      background: var(--primary);
      padding: 32px 40px;
      color: var(--white);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header-left h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header-left p { margin: 4px 0 0; font-size: 10px; opacity: 0.9; }
    .header-right { text-align: right; }
    .header-right h2 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; }
    .header-right p { margin: 4px 0 0; font-size: 10px; opacity: 0.9; }

    .filter-bar {
      background: var(--danger-lt);
      padding: 10px 40px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      background: var(--white);
      border: 1px solid #fca5a5;
      color: var(--danger);
      border-radius: 20px;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 500;
    }

    .stats-row {
      display: flex;
      border-bottom: 1px solid var(--border);
    }
    .stat-box {
      flex: 1;
      padding: 16px 40px;
      border-right: 1px solid var(--border);
    }
    .stat-box:last-child { border-right: none; }
    .stat-value { font-size: 28px; font-weight: 700; color: var(--primary); display: block; }
    .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; font-weight: 600; margin-top: 4px; display: block; }

    .table-container { padding: 30px 40px; }
    table { width: 100%; border-collapse: collapse; }
    thead { background: var(--primary); }
    th {
      color: var(--white);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 10px;
      text-align: left;
    }
    td {
      padding: 11px 10px;
      font-size: 11px;
      border-bottom: 1px solid var(--border);
    }
    tr:nth-child(even) { background: var(--surface); }
    tr { page-break-inside: avoid; }

    .student-info { display: flex; align-items: center; gap: 10px; }
    .photo { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
    .initials {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--primary-lt); color: var(--primary);
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 600;
    }
    .left-date { font-weight: 700; color: var(--danger); }
    .reason-badge {
      background: var(--danger-lt); color: #991b1b;
      padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 500;
      display: inline-block;
    }
    .row-num { color: #94a3b8; font-size: 10px; }

    .footer {
      position: fixed; bottom: 20px; left: 0; right: 0;
      padding: 0 40px;
      display: flex; justify-content: space-between;
      font-size: 9px; color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>${schoolData.name}</h1>
      <p>${schoolData.branch_name || ''} | ${schoolData.address || ''}</p>
      <p>Tel: ${schoolData.phone || ''} | ${schoolData.email || ''}</p>
    </div>
    <div class="header-right">
      <h2>STUDENT LEAVERS LIST</h2>
      <p>Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
      <p>By: ${req.user.name}</p>
    </div>
  </div>

  <div class="filter-bar">
    ${session_id ? `<div class="chip">Session: ${students[0]?.session_name || 'Selected'}</div>` : ''}
    ${class_id ? `<div class="chip">Class: ${students[0]?.class_name || 'Selected'}</div>` : ''}
    ${leaving_reason ? `<div class="chip">Reason: ${leaving_reason}</div>` : ''}
    ${from_date || to_date ? `<div class="chip">Date: ${from_date || '...'} to ${to_date || '...'}</div>` : ''}
    <div class="chip">Total Records: ${students.length}</div>
  </div>

  <div class="stats-row">
    <div class="stat-box">
      <span class="stat-value">${students.length}</span>
      <span class="stat-label">Total Leavers</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${new Set(students.map(s => s.session_name)).size}</span>
      <span class="stat-label">Sessions</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${students.filter(s => s.leaving_reason === 'Completed Studies').length}</span>
      <span class="stat-label">Completed</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${from_date && to_date ? 'Custom' : 'All Time'}</span>
      <span class="stat-label">Date Range</span>
    </div>
  </div>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th style="width: 4%">#</th>
          <th style="width: 11%">Admission No</th>
          <th style="width: 22%">Student Name</th>
          <th style="width: 10%">Class</th>
          <th style="width: 9%">Section</th>
          <th style="width: 12%">Left Date</th>
          <th style="width: 17%">Reason</th>
          <th style="width: 15%">Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${students.map((s, i) => `
          <tr>
            <td class="row-num">${i + 1}</td>
            <td>${s.admission_no}</td>
            <td>
              <div class="student-info">
                ${s.photo_url 
                  ? `<img src="${s.photo_url}" class="photo" onerror="this.style.display='none'">` 
                  : `<div class="initials">${s.first_name[0]}${s.last_name[0]}</div>`
                }
                <span>${s.first_name} ${s.last_name}</span>
              </div>
            </td>
            <td>${s.class_name}</td>
            <td>${s.section_name}</td>
            <td class="left-date">${s.left_date ? new Date(s.left_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
            <td><span class="reason-badge">${s.leaving_reason || '—'}</span></td>
            <td style="color: #64748b; font-size: 10px;">${s.leaving_remarks || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <span>${schoolData.name}</span>
    <span>Confidential — For Administrative Use Only</span>
    <span>Generated by EduCore</span>
  </div>
</body>
</html>
    `;

    const pdfBuffer = await renderPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="leavers_list.pdf"');
    res.end(pdfBuffer);
  } catch (err) { next(err); }
};

exports.downloadGraduatedStudentsPdf = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { 
      search = '', 
      class_id = '', 
      session_id = '' 
    } = req.query;

    const replacements = { 
      schoolId, 
      search: `%${search}%`,
      classId: class_id ? parseInt(class_id, 10) : null,
      sessionId: session_id ? parseInt(session_id, 10) : null
    };

    const [[school]] = await sequelize.query(`
      SELECT name, branch_name, address, phone, email FROM schools WHERE id = :schoolId LIMIT 1
    `, { replacements: { schoolId } });

    if (!school) {
      console.warn(`[PDF Export] School with ID ${schoolId} not found. Using default values.`);
    }

    const schoolData = school || { name: 'Institution', branch_name: '', address: '', phone: '', email: '' };

    const [students] = await sequelize.query(`
      SELECT DISTINCT ON (s.id)
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url,
        c.name AS class_name, sec.name AS section_name, sess.name AS session_name,
        sr.percentage, sr.grade
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      JOIN enrollments e ON e.student_id = s.id AND e.leaving_type = 'graduated'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN sessions sess ON sess.id = e.session_id
      LEFT JOIN student_results sr ON sr.enrollment_id = e.id
      WHERE s.school_id = :schoolId 
        AND s.status = 'graduated'
        AND s.is_deleted = false
        AND (s.first_name ILIKE :search OR s.last_name ILIKE :search OR s.admission_no ILIKE :search)
        AND (:classId IS NULL OR e.class_id = :classId)
        AND (:sessionId IS NULL OR e.session_id = :sessionId)
      ORDER BY s.id, e.left_date DESC
    `, { replacements });

    const getGradeClass = (grade) => {
      const g = (grade || '').toUpperCase();
      if (['A+', 'A'].includes(g)) return 'grade-a';
      if (['B+', 'B'].includes(g)) return 'grade-b';
      if (['C+', 'C'].includes(g)) return 'grade-c';
      return 'grade-d';
    };

    const html = `
<!DOCTYPE html>
<html>
<head>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary:    #15803d;
      --primary-lt: #dcfce7;
      --accent:     #166534;
      --accent-lt:  #f0fdf4;
      --text:       #0f172a;
      --muted:      #64748b;
      --border:     #e2e8f0;
      --surface:    #f8fafc;
      --white:      #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      margin: 0; padding: 0;
      color: var(--text); background: var(--white);
      -webkit-print-color-adjust: exact;
    }
    .header {
      background: var(--primary); padding: 32px 40px;
      color: var(--white); display: flex; justify-content: space-between; align-items: flex-start;
    }
    .header-left h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header-left p { margin: 4px 0 0; font-size: 10px; opacity: 0.9; }
    .header-right { text-align: right; }
    .header-right h2 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; }
    .header-right p { margin: 4px 0 0; font-size: 10px; opacity: 0.9; }

    .filter-bar {
      background: var(--accent-lt); padding: 10px 40px;
      display: flex; flex-wrap: wrap; gap: 8px;
    }
    .chip {
      background: var(--white); border: 1px solid #86efac;
      color: var(--primary); border-radius: 20px;
      padding: 3px 10px; font-size: 11px; font-weight: 500;
    }

    .stats-row { display: flex; border-bottom: 1px solid var(--border); }
    .stat-box { flex: 1; padding: 16px 40px; border-right: 1px solid var(--border); }
    .stat-box:last-child { border-right: none; }
    .stat-value { font-size: 28px; font-weight: 700; color: var(--primary); display: block; }
    .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; font-weight: 600; margin-top: 4px; display: block; }

    .table-container { padding: 30px 40px; }
    table { width: 100%; border-collapse: collapse; }
    thead { background: var(--primary); }
    th {
      color: var(--white); font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em;
      padding: 12px 10px; text-align: left;
    }
    td { padding: 11px 10px; font-size: 11px; border-bottom: 1px solid var(--border); }
    tr:nth-child(even) { background: var(--surface); }
    tr { page-break-inside: avoid; }

    .student-info { display: flex; align-items: center; gap: 10px; }
    .photo { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
    .initials {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--primary-lt); color: var(--primary);
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 600;
    }

    .grade-badge {
      padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; display: inline-block;
    }
    .grade-a { background: #dcfce7; color: #166534; }
    .grade-b { background: #dbeafe; color: #1e40af; }
    .grade-c { background: #fef9c3; color: #854d0e; }
    .grade-d { background: #fee2e2; color: #991b1b; }

    .progress-outer { width: 100%; background: #e2e8f0; height: 6px; border-radius: 3px; margin-top: 4px; overflow: hidden; }
    .progress-inner { height: 100%; background: var(--primary); border-radius: 3px; }
    .percentage-text { font-weight: 700; font-size: 11px; }

    .row-num { color: #94a3b8; font-size: 10px; }
    .footer {
      position: fixed; bottom: 20px; left: 0; right: 0;
      padding: 0 40px; display: flex; justify-content: space-between;
      font-size: 9px; color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>${schoolData.name}</h1>
      <p>${schoolData.branch_name || ''} | ${schoolData.address || ''}</p>
      <p>Tel: ${schoolData.phone || ''} | ${schoolData.email || ''}</p>
    </div>
    <div class="header-right">
      <h2>GRADUATED STUDENTS LIST</h2>
      <p>Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
      <p>By: ${req.user.name}</p>
    </div>
  </div>

  <div class="filter-bar">
    ${session_id ? `<div class="chip">Session: ${students[0]?.session_name || 'Selected'}</div>` : ''}
    ${class_id ? `<div class="chip">Class: ${students[0]?.class_name || 'Selected'}</div>` : ''}
    <div class="chip">Total Records: ${students.length}</div>
  </div>

  <div class="stats-row">
    <div class="stat-box">
      <span class="stat-value">${students.length}</span>
      <span class="stat-label">Total Graduates</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${new Set(students.map(s => s.session_name)).size}</span>
      <span class="stat-label">Sessions</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${students.length > 0 ? (students.reduce((acc, s) => acc + parseFloat(s.percentage || 0), 0) / students.length).toFixed(1) + '%' : '0%'}</span>
      <span class="stat-label">Avg. Percentage</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${students.length > 0 ? [...students].sort((a,b) => parseFloat(b.percentage || 0) - parseFloat(a.percentage || 0))[0].grade : '—'}</span>
      <span class="stat-label">Top Grade</span>
    </div>
  </div>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th style="width: 5%">#</th>
          <th style="width: 15%">Admission No</th>
          <th style="width: 25%">Student Name</th>
          <th style="width: 15%">Class (Section)</th>
          <th style="width: 15%">Session</th>
          <th style="width: 15%">Score %</th>
          <th style="width: 10%">Grade</th>
        </tr>
      </thead>
      <tbody>
        ${students.map((s, i) => `
          <tr>
            <td class="row-num">${i + 1}</td>
            <td>${s.admission_no}</td>
            <td>
              <div class="student-info">
                ${s.photo_url 
                  ? `<img src="${s.photo_url}" class="photo" onerror="this.style.display='none'">` 
                  : `<div class="initials">${s.first_name[0]}${s.last_name[0]}</div>`
                }
                <span>${s.first_name} ${s.last_name}</span>
              </div>
            </td>
            <td>${s.class_name} (${s.section_name})</td>
            <td>${s.session_name}</td>
            <td>
              <span class="percentage-text">${s.percentage || '0'}%</span>
              <div class="progress-outer"><div class="progress-inner" style="width: ${s.percentage || 0}%"></div></div>
            </td>
            <td><span class="grade-badge ${getGradeClass(s.grade)}">${s.grade || '—'}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <span>${schoolData.name}</span>
    <span>Confidential — For Administrative Use Only</span>
    <span>Generated by EduCore</span>
  </div>
</body>
</html>
    `;

    const pdfBuffer = await renderPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="graduated_list.pdf"');
    res.end(pdfBuffer);
  } catch (err) { next(err); }
};

/**
 * Mark a student as left.
 * Updates student status and closes active enrollment.
 */
exports.markAsLeft = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { left_date, leaving_reason, leaving_remarks } = req.body;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT id FROM students WHERE id = :id AND school_id = :schoolId
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    const [[activeEnrollment]] = await sequelize.query(`
      SELECT id FROM enrollments WHERE student_id = :id AND status = 'active'
    `, { replacements: { id } });

    if (!activeEnrollment) {
      return res.fail('Student has no active enrollment. Cannot mark as left.', [], 400);
    }

    const finalLeftDate = left_date || new Date().toISOString().split('T')[0];

    await sequelize.query(`
      UPDATE enrollments
      SET status = 'inactive',
          left_date = :finalLeftDate,
          leaving_type = 'left',
          updated_at = NOW()
      WHERE id = :enrollmentId;
    `, { replacements: { enrollmentId: activeEnrollment.id, finalLeftDate } });

    await sequelize.query(`
      UPDATE students
      SET status = 'left',
          left_date = :finalLeftDate,
          leaving_reason = :leaving_reason,
          leaving_remarks = :leaving_remarks,
          is_active = false,
          updated_at = NOW()
      WHERE id = :id;
    `, { replacements: { id, finalLeftDate, leaving_reason, leaving_remarks } });

    res.ok({}, 'Student marked as left successfully.');
  } catch (err) { next(err); }
};

exports.markAsGraduated = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { graduated_date, remarks } = req.body;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT id, status FROM students WHERE id = :id AND school_id = :schoolId
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);
    if (student.status !== 'active') {
      return res.fail(`Cannot mark as graduated. Student status is already '${student.status}'.`, [], 400);
    }

    const [[activeEnrollment]] = await sequelize.query(`
      SELECT id FROM enrollments WHERE student_id = :id AND status = 'active'
    `, { replacements: { id } });

    if (!activeEnrollment) {
      return res.fail('Student has no active enrollment. Cannot mark as graduated.', [], 400);
    }

    const finalDate = graduated_date || new Date().toISOString().split('T')[0];

    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        UPDATE enrollments
        SET status = 'inactive',
            left_date = :finalDate,
            leaving_type = 'graduated',
            updated_at = NOW()
        WHERE id = :enrollmentId;
      `, { replacements: { enrollmentId: activeEnrollment.id, finalDate }, transaction: t });

      await sequelize.query(`
        UPDATE students
        SET status = 'graduated',
            left_date = :finalDate,
            leaving_remarks = :remarks,
            is_active = false,
            updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id, finalDate, remarks }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('students', :id, 'status', 'active', 'graduated',
           :changedBy, 'Student marked as graduated manually', :ip, :device, NOW())
      `, { replacements: {
        id,
        changedBy: req.user.id,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });
    });

    res.ok({}, 'Student marked as graduated successfully.');
  } catch (err) { next(err); }
};

exports.getLeftStudents = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { 
      page = 1, 
      perPage = 20, 
      search = '', 
      leaving_reason = '', 
      class_id = '', 
      session_id = '',
      from_date = '',
      to_date = ''
    } = req.query;

    const limitNum = parseInt(perPage, 10) || 20;
    const offsetNum = (parseInt(page, 10) - 1) * limitNum;

    const replacements = { 
      schoolId, 
      search: `%${search}%`,
      leaving_reason: leaving_reason || null,
      classId: class_id ? parseInt(class_id, 10) : null,
      sessionId: session_id ? parseInt(session_id, 10) : null,
      fromDate: from_date || null,
      toDate: to_date || null,
      limit: limitNum,
      offset: offsetNum
    };

    const baseQuery = `
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.leaving_type = 'left'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN sessions sess ON sess.id = e.session_id
      WHERE s.school_id = :schoolId 
        AND s.status = 'left'
        AND s.is_deleted = false
        AND (s.first_name ILIKE :search OR s.last_name ILIKE :search OR s.admission_no ILIKE :search)
        AND (:leaving_reason IS NULL OR s.leaving_reason = :leaving_reason)
        AND (:classId IS NULL OR e.class_id = :classId)
        AND (:sessionId IS NULL OR e.session_id = :sessionId)
        AND (:fromDate IS NULL OR s.left_date >= CAST(:fromDate AS DATE))
        AND (:toDate IS NULL OR s.left_date <= CAST(:toDate AS DATE))
    `;

    const [[{ count }]] = await sequelize.query(`SELECT COUNT(DISTINCT s.id)::int AS count ${baseQuery}`, { replacements });
    
    const [students] = await sequelize.query(`
      SELECT DISTINCT ON (s.id)
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url, 
        s.left_date AS student_left_date, s.leaving_reason,
        c.name AS class_name, sec.name AS section_name, sess.name AS session_name
      ${baseQuery}
      ORDER BY s.id, e.left_date DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    res.ok({
      students: students.map(s => ({ ...s, left_date: s.student_left_date })),
      pagination: {
        total: parseInt(count, 10),
        page: parseInt(page, 10),
        perPage: limitNum,
        totalPages: Math.max(Math.ceil(count / limitNum), 1)
      }
    }, 'Left students retrieved.');
  } catch (err) { next(err); }
};

exports.getGraduatedStudents = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { 
      page = 1, 
      perPage = 20, 
      search = '', 
      class_id = '', 
      session_id = '' 
    } = req.query;

    const limitNum = parseInt(perPage, 10) || 20;
    const offsetNum = (parseInt(page, 10) - 1) * limitNum;

    const replacements = { 
      schoolId, 
      search: `%${search}%`,
      classId: class_id ? parseInt(class_id, 10) : null,
      sessionId: session_id ? parseInt(session_id, 10) : null,
      limit: limitNum,
      offset: offsetNum
    };

    const baseQuery = `
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      JOIN enrollments e ON e.student_id = s.id AND e.leaving_type = 'graduated'
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN sessions sess ON sess.id = e.session_id
      LEFT JOIN student_results sr ON sr.enrollment_id = e.id
      WHERE s.school_id = :schoolId 
        AND s.status = 'graduated'
        AND s.is_deleted = false
        AND (s.first_name ILIKE :search OR s.last_name ILIKE :search OR s.admission_no ILIKE :search)
        AND (:classId IS NULL OR e.class_id = :classId)
        AND (:sessionId IS NULL OR e.session_id = :sessionId)
    `;

    const [[{ count }]] = await sequelize.query(`SELECT COUNT(DISTINCT s.id)::int AS count ${baseQuery}`, { replacements });
    
    const [students] = await sequelize.query(`
      SELECT DISTINCT ON (s.id)
        s.id, s.admission_no, s.first_name, s.last_name, sp.photo_path AS photo_url,
        c.name AS class_name, sec.name AS section_name, sess.name AS session_name,
        sr.percentage, sr.grade
      ${baseQuery}
      ORDER BY s.id, e.left_date DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    res.ok({
      students,
      pagination: {
        total: parseInt(count, 10),
        page: parseInt(page, 10),
        perPage: limitNum,
        totalPages: Math.max(Math.ceil(count / limitNum), 1)
      }
    }, 'Graduated students retrieved.');
  } catch (err) { next(err); }
};

exports.getEnrollmentHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [history] = await sequelize.query(`
      SELECT 
        e.id, e.joined_date, e.left_date, e.joining_type, e.leaving_type, e.status, e.roll_number,
        c.name AS class_name, sec.name AS section_name, sess.name AS session_name,
        sr.result, sr.percentage, sr.grade
      FROM enrollments e
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      LEFT JOIN student_results sr ON sr.enrollment_id = e.id
      JOIN students s ON s.id = e.student_id
      WHERE e.student_id = :id AND s.school_id = :schoolId
      ORDER BY e.joined_date DESC;
    `, { replacements: { id, schoolId } });

    res.ok(history, 'Enrollment history retrieved.');
  } catch (err) { next(err); }
};

exports.readmitStudent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { session_id, class_id, section_id, joined_date, roll_number } = req.body;
    const schoolId = req.user.school_id;

    const [[student]] = await sequelize.query(`
      SELECT id FROM students WHERE id = :id AND school_id = :schoolId
    `, { replacements: { id, schoolId } });

    if (!student) return res.fail('Student not found.', [], 404);

    const [[lastEnrollment]] = await sequelize.query(`
      SELECT id FROM enrollments WHERE student_id = :id ORDER BY joined_date DESC LIMIT 1
    `, { replacements: { id } });

    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        INSERT INTO enrollments (
          student_id, session_id, class_id, section_id, roll_number, 
          joined_date, joining_type, status, previous_enrollment_id, created_at, updated_at
        ) VALUES (
          :id, :session_id, :class_id, :section_id, :roll_number, 
          :joined_date, 'rejoined', 'active', :prevId, NOW(), NOW()
        )
      `, { replacements: { 
        id, session_id, class_id, section_id, roll_number, 
        joined_date: joined_date || new Date().toISOString().split('T')[0],
        prevId: lastEnrollment ? lastEnrollment.id : null
      }, transaction: t });

      const oldStatus = student.status || 'left';

      await sequelize.query(`
        UPDATE students
        SET status = 'active',
            left_date = null,
            leaving_reason = null,
            leaving_remarks = null,
            is_active = true,
            updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id }, transaction: t });

      await sequelize.query(`
        INSERT INTO audit_logs
          (table_name, record_id, field_name, old_value, new_value,
           changed_by, reason, ip_address, device_info, created_at)
        VALUES
          ('students', :id, 'status', :oldStatus, 'active',
           :changedBy, 'Student re-admitted', :ip, :device, NOW())
      `, { replacements: {
        id,
        oldStatus,
        changedBy: req.user.id,
        ip: req.ip || null,
        device: (req.headers['user-agent'] || '').slice(0, 299)
      }, transaction: t });
    });

    res.ok({}, 'Student re-admitted successfully.');
  } catch (err) { next(err); }
};

exports.getLeavingSummary = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { session_id } = req.query;

    const replacements = { 
      schoolId, 
      sessionId: session_id ? parseInt(session_id, 10) : null 
    };

    const [[stats]] = await sequelize.query(`
      SELECT
        COALESCE((SELECT COUNT(*)::int FROM students WHERE school_id = :schoolId AND status = 'active' AND is_deleted = false), 0) AS total_active,
        COALESCE((SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.school_id = :schoolId AND (:sessionId IS NULL OR e.session_id = :sessionId) AND e.leaving_type = 'left'), 0) AS left_this_session,
        COALESCE((SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.school_id = :schoolId AND (:sessionId IS NULL OR e.session_id = :sessionId) AND e.leaving_type = 'graduated'), 0) AS graduated_this_session,
        COALESCE((SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.school_id = :schoolId AND (:sessionId IS NULL OR e.session_id = :sessionId) AND e.joining_type = 'rejoined'), 0) AS readmissions_this_session
    `, { replacements });

    res.ok(stats || { total_active: 0, left_this_session: 0, graduated_this_session: 0, readmissions_this_session: 0 }, 'Leaving summary retrieved.');
  } catch (err) { next(err); }
};
