'use strict';

const sequelize = require('../config/database');
const { getAttendancePercent } = require('../utils/attendanceCalculator');
const { invalidateCache } = require('../middlewares/cache');
const { writeAuditLog } = require('../utils/writeAuditLog');

function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return null;
  return Number(normalized);
}

const TODAY = () => new Date().toISOString().slice(0, 10);

async function getCurrentSessionForSchool(schoolId) {
  const [[session]] = await sequelize.query(`
    SELECT id, name, status, is_current
    FROM sessions
    WHERE school_id = :schoolId
      AND is_current = true
    LIMIT 1;
  `, { replacements: { schoolId } });

  return session || null;
}

async function resolveSessionId({ requestedSessionId, schoolId, allowLocked = false }) {
  let sessionId = null;
  if (requestedSessionId != null) {
    const [[session]] = await sequelize.query(`
      SELECT id, is_locked
      FROM sessions
      WHERE id = :sessionId
        AND school_id = :schoolId
      LIMIT 1;
    `, { replacements: { sessionId: requestedSessionId, schoolId } });
    if (session) {
      if (session.is_locked && !allowLocked) {
        const error = new Error('Session is locked. Cannot mark attendance.');
        error.status = 422;
        throw error;
      }
      sessionId = session.id;
    }
  } else {
    const session = await getCurrentSessionForSchool(schoolId);
    if (session) {
      if (session.is_locked && !allowLocked) {
        const error = new Error('Current session is locked. Cannot mark attendance.');
        error.status = 422;
        throw error;
      }
      sessionId = session.id;
    }
  }

  return sessionId;
}

// ── POST /api/attendance/mark ─────────────────────────────────────────────────
exports.markSingle = async (req, res, next) => {
  try {
    const { enrollment_id, date, status, method, session_id } = req.body;

    const sessionId = await resolveSessionId({
      requestedSessionId: session_id,
      schoolId: req.user.school_id,
    });

    if (sessionId == null) {
      return res.fail('No active session found. Cannot mark attendance.', [], 422);
    }

    const [[existing]] = await sequelize.query(`
      SELECT id FROM attendance WHERE enrollment_id = :enrollment_id AND date = :date;
    `, { replacements: { enrollment_id, date } });

    if (existing) {
      return res.fail('Attendance already marked for this date. Use PATCH to override.', [], 409);
    }

    const [[record]] = await sequelize.query(`
      INSERT INTO attendance (enrollment_id, date, status, method, marked_by, marked_at, created_at, updated_at)
      VALUES (:enrollment_id, :date, :status, :method, :marked_by, NOW(), NOW(), NOW())
      RETURNING id, enrollment_id, date, status, method;
    `, { replacements: { enrollment_id, date, status, method, marked_by: req.user.id } });

    await writeAuditLog(sequelize, {
      tableName: 'attendance',
      recordId: record.id,
      changes: { field: 'status', oldValue: null, newValue: status },
      changedBy: req.user.id,
      reason: `Attendance marked: ${method}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    res.ok(record, 'Attendance marked.', 201);
    invalidateCache(req.user.school_id, '/api/attendance*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

// ── POST /api/attendance/bulk ─────────────────────────────────────────────────
exports.markBulk = async (req, res, next) => {
  try {
    const { date, records, session_id, section_id } = req.body;

    const sessionId = await resolveSessionId({
      requestedSessionId: session_id,
      schoolId: req.user.school_id,
    });

    if (sessionId == null) {
      return res.fail('No active session found. Cannot mark attendance.', [], 422);
    }

    const inserted = [];
    const updated  = [];
    let skipped = 0;

    await sequelize.transaction(async (t) => {
      for (const rec of records) {
        // Verify each enrollment belongs to the declared section and session
        const [[enrollment]] = await sequelize.query(`
          SELECT id FROM enrollments
          WHERE id = :eid AND section_id = :sectionId AND session_id = :sessionId;
        `, { replacements: { eid: rec.enrollment_id, sectionId: section_id, sessionId }, transaction: t });

        if (!enrollment) {
          skipped++;
          continue;
        }

        const [[existing]] = await sequelize.query(`
          SELECT id, status FROM attendance WHERE enrollment_id = :eid AND date = :date;
        `, { replacements: { eid: rec.enrollment_id, date }, transaction: t });

        if (existing) {
          await sequelize.query(`
            UPDATE attendance
            SET status = :status,
                method = 'manual',
                marked_by = :marked_by,
                marked_at = NOW(),
                updated_at = NOW()
            WHERE id = :id;
          `, {
            replacements: {
              id: existing.id,
              status: rec.status,
              marked_by: req.user.id,
            },
            transaction: t,
          });

          updated.push(rec.enrollment_id);
          continue;
        }

        await sequelize.query(`
          INSERT INTO attendance (enrollment_id, date, status, method, marked_by, marked_at, created_at, updated_at)
          VALUES (:eid, :date, :status, 'manual', :marked_by, NOW(), NOW(), NOW());
        `, { replacements: { eid: rec.enrollment_id, date, status: rec.status, marked_by: req.user.id }, transaction: t });

        inserted.push(rec.enrollment_id);
      }
    });

    await writeAuditLog(sequelize, {
      tableName: 'attendance',
      recordId: Number(section_id) || 0,
      changes: { field: 'bulk_marking', oldValue: 'none', newValue: `${inserted.length + updated.length} records` },
      changedBy: req.user.id,
      reason: `Bulk attendance marking for ${date}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    res.ok({
      date,
      marked  : inserted.length,
      updated : updated.length,
      skipped,
      updated_enrollment_ids: updated,
    }, `${inserted.length} record(s) marked. ${updated.length} updated. ${skipped} skipped.`);
    invalidateCache(req.user.school_id, '/api/attendance*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

// ── GET /api/attendance/class ────────────────────────────────────────────────
exports.getClassAttendance = async (req, res, next) => {
  try {
    const parsedSessionId = parseOptionalInteger(req.query.session_id);
    const parsedClassId = parseOptionalInteger(req.query.class_id);
    const parsedSectionId = parseOptionalInteger(req.query.section_id);
    const date = req.query.date || TODAY();

    if (parsedClassId == null) {
      return res.fail('class_id must be a valid integer.', [], 422);
    }

    if (parsedSectionId == null) {
      return res.fail('section_id must be a valid integer.', [], 422);
    }

    const sessionId = await resolveSessionId({
      requestedSessionId: parsedSessionId,
      schoolId: req.user.school_id,
      allowLocked: true,
    });

    if (sessionId == null) {
      return res.fail('No active session found for this school.', [], 422);
    }

    const [students] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.roll_number,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        sp.photo_path,
        a.id AS attendance_id,
        a.status,
        a.override_reason
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date = :date
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
      ORDER BY
        COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer,
        e.roll_number,
        s.first_name,
        s.last_name;
    `, {
      replacements: {
        date,
        sessionId,
        classId: parsedClassId,
        sectionId: parsedSectionId,
      },
    });

    const [[holiday]] = await sequelize.query(`
      SELECT id, name
      FROM session_holidays
      WHERE session_id = :sessionId
        AND holiday_date = :date
      LIMIT 1;
    `, { replacements: { sessionId, date } });

    const alreadyMarked = students.some((student) => student.attendance_id);

    res.ok({
      session_id: sessionId,
      class_id: parsedClassId,
      section_id: parsedSectionId,
      date,
      is_holiday: !!holiday,
      holiday,
      already_marked: alreadyMarked,
      students: students.map((student) => ({
        ...student,
        status: student.status || 'present',
      })),
    }, `${students.length} student(s) loaded for attendance.`);
  } catch (err) { next(err); }
};

// ── GET /api/attendance/register ─────────────────────────────────────────────
exports.getClassRegister = async (req, res, next) => {
  try {
    const parsedSessionId = parseOptionalInteger(req.query.session_id);
    const parsedClassId = parseOptionalInteger(req.query.class_id);
    const parsedSectionId = parseOptionalInteger(req.query.section_id);
    const monthNum = Number(req.query.month);
    const yearNum = Number(req.query.year);

    if (parsedClassId == null) {
      return res.fail('class_id must be a valid integer.', [], 422);
    }

    if (parsedSectionId == null) {
      return res.fail('section_id must be a valid integer.', [], 422);
    }

    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.fail('month must be between 1 and 12.', [], 422);
    }

    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
      return res.fail('year must be a valid 4-digit year.', [], 422);
    }

    const sessionId = await resolveSessionId({
      requestedSessionId: parsedSessionId,
      schoolId: req.user.school_id,
      allowLocked: true,
    });

    if (sessionId == null) {
      return res.fail('No active session found for this school.', [], 422);
    }

    const fromDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const toDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [rows] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id,
        e.roll_number,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', a.id,
              'attendance_id', a.id,
              'date', a.date,
              'status', a.status,
              'reason', a.override_reason,
              'override_reason', a.override_reason,
              'method', a.method
            )
            ORDER BY a.date
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) AS attendance,
        ROUND(
          (
            (
              COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))
              + COUNT(*) FILTER (WHERE a.status = 'half_day') * 0.5
            )::numeric
            / NULLIF((COUNT(*) FILTER (WHERE a.status != 'holiday'))::numeric, 0)
          ) * 100,
          2
        ) AS percentage
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN attendance a
        ON a.enrollment_id = e.id
       AND a.date BETWEEN :fromDate AND :toDate
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
      GROUP BY e.id, e.roll_number, s.id, s.first_name, s.last_name
      ORDER BY
        COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer,
        e.roll_number,
        s.first_name,
        s.last_name;
    `, {
      replacements: {
        fromDate,
        toDate,
        sessionId,
        classId: parsedClassId,
        sectionId: parsedSectionId,
      },
    });

    res.ok({
      session_id: sessionId,
      class_id: parsedClassId,
      section_id: parsedSectionId,
      month: monthNum,
      year: yearNum,
      students: rows.map((row) => ({
        ...row,
        student_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      })),
    }, `${rows.length} student(s) found in attendance register.`);
  } catch (err) { next(err); }
};

exports.downloadRegisterPdf = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { session_id, class_id, section_id, month, year } = req.query;

    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    const classId = parseInt(class_id, 10);
    const sectionId = parseInt(section_id, 10);

    const fromDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const toDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const school = await sequelize.query(`SELECT name, address FROM schools WHERE id = :schoolId LIMIT 1`, {
      replacements: { schoolId },
      type: sequelize.QueryTypes.SELECT
    }).then(r => r[0]);

    const [[meta]] = await sequelize.query(`
      SELECT c.name AS class_name, sec.name AS section_name, sess.name AS session_name
      FROM classes c
      JOIN sections sec ON sec.class_id = c.id
      JOIN sessions sess ON sess.id = :sessionId
      WHERE c.id = :classId AND sec.id = :sectionId LIMIT 1;
    `, { replacements: { classId, sectionId, sessionId: session_id } });

    const [students] = await sequelize.query(`
      SELECT
        e.id AS enrollment_id, e.roll_number, s.first_name, s.last_name,
        COALESCE(JSON_AGG(JSON_BUILD_OBJECT('date', a.date, 'status', a.status) ORDER BY a.date) FILTER (WHERE a.id IS NOT NULL), '[]'::json) AS records
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN attendance a ON a.enrollment_id = e.id AND a.date BETWEEN :fromDate AND :toDate
      WHERE e.session_id = :sessionId AND e.class_id = :classId AND e.section_id = :sectionId AND e.status = 'active'
      GROUP BY e.id, e.roll_number, s.id, s.first_name, s.last_name
      ORDER BY COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer, e.roll_number, s.first_name;
    `, { replacements: { fromDate, toDate, sessionId: session_id, classId, sectionId } });

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ 
      margins: { top: 40, left: 40, right: 40, bottom: 20 }, 
      size: 'A4', 
      layout: 'landscape',
      bufferPages: true 
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Attendance_Register_${meta.class_name}_${meta.section_name}_${month}_${year}.pdf"`);
    doc.pipe(res);

    const monthName = new Date(yearNum, monthNum - 1).toLocaleString('default', { month: 'long' });

    const drawHeader = () => {
      doc.fillColor('#0f766e').fontSize(14).font('Helvetica-Bold').text(school.name.toUpperCase(), { align: 'center' });
      doc.fillColor('#64748b').fontSize(8).font('Helvetica').text(school.address, { align: 'center' });
      doc.moveDown(0.4);
      doc.fillColor('#1e293b').fontSize(11).font('Helvetica-Bold').text(`MONTHLY ATTENDANCE REGISTER - ${monthName.toUpperCase()} ${yearNum}`, { align: 'center' });
      doc.fontSize(9).text(`Class: ${meta.class_name} (${meta.section_name}) | Session: ${meta.session_name}`, { align: 'center' });
      doc.moveDown(0.8);
    };

    drawHeader();

    const startX = 40;
    const nameWidth = 130;
    const rollWidth = 30;
    const dayWidth = (doc.page.width - 80 - nameWidth - rollWidth - 40) / lastDay; // Extra 40 for totals
    const rowHeight = 16;

    const drawGridHeader = (y) => {
      doc.fillColor('#f8fafc').rect(startX, y, doc.page.width - 80, rowHeight).fill();
      doc.fillColor('#475569').fontSize(7).font('Helvetica-Bold');
      doc.text('ROLL', startX + 2, y + 4, { width: rollWidth });
      doc.text('STUDENT NAME', startX + rollWidth + 5, y + 4, { width: nameWidth });
      
      for (let d = 1; d <= lastDay; d++) {
        const x = startX + rollWidth + nameWidth + (d - 1) * dayWidth;
        doc.text(d.toString(), x, y + 4, { width: dayWidth, align: 'center' });
      }
      
      doc.text('P', startX + rollWidth + nameWidth + lastDay * dayWidth + 5, y + 4, { width: 15, align: 'center' });
      doc.text('A', startX + rollWidth + nameWidth + lastDay * dayWidth + 20, y + 4, { width: 15, align: 'center' });
    };

    drawGridHeader(doc.y);
    doc.moveDown(0.1);

    students.forEach((student, index) => {
      // Landscape A4 is 595.28 high. Margin 20 means bottom is 575.28.
      if (doc.y > 530) {
        doc.addPage();
        drawHeader();
        drawGridHeader(doc.y);
        doc.moveDown(0.1);
      }

      const y = doc.y;
      doc.fillColor('#1e293b').fontSize(7).font('Helvetica');
      
      // Zebra striping
      if (index % 2 === 1) {
        doc.fillColor('#f1f5f9').rect(startX, y, doc.page.width - 80, rowHeight).fill();
        doc.fillColor('#1e293b');
      }

      doc.text(student.roll_number || '-', startX + 2, y + 4, { width: rollWidth });
      doc.text(`${student.first_name} ${student.last_name}`, startX + rollWidth + 5, y + 4, { width: nameWidth, lineBreak: false });

      let pCount = 0;
      let aCount = 0;

      for (let d = 1; d <= lastDay; d++) {
        const x = startX + rollWidth + nameWidth + (d - 1) * dayWidth;
        const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const record = student.records.find(r => r.date === dateStr);
        
        let char = '·';
        let color = '#94a3b8';

        if (record) {
          if (record.status === 'present') {
            char = 'P'; color = '#15803d'; pCount++;
          } else if (record.status === 'late') {
            char = 'L'; color = '#d97706'; pCount++;
          } else if (record.status === 'absent') {
            char = 'A'; color = '#b91c1c'; aCount++;
          } else if (record.status === 'half_day') {
            char = '½'; color = '#1d4ed8'; pCount += 0.5;
          }
        }
        
        doc.fillColor(color).font('Helvetica-Bold').text(char, x, y + 5, { width: dayWidth, align: 'center' });
      }

      doc.fillColor('#1e293b').font('Helvetica-Bold');
      doc.text(pCount.toString(), startX + rollWidth + nameWidth + lastDay * dayWidth + 5, y + 5, { width: 15, align: 'center' });
      doc.text(aCount.toString(), startX + rollWidth + nameWidth + lastDay * dayWidth + 20, y + 5, { width: 15, align: 'center' });

      doc.moveDown(1);
      doc.strokeColor('#e2e8f0').lineWidth(0.2).moveTo(startX, doc.y).lineTo(doc.page.width - 30, doc.y).stroke();
    });

    // Legend
    doc.moveDown(1);
    doc.fontSize(7).font('Helvetica').fillColor('#64748b');
    doc.text('P: Present | A: Absent | L: Late | ½: Half Day | ·: Not Marked', startX, doc.y);

    // Pagination
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.text(`Page ${i + 1} of ${range.count}`, 30, doc.page.height - 25, { align: 'right', width: doc.page.width - 60 });
    }

    doc.end();
  } catch (err) { next(err); }
};

// ── GET /api/attendance/:enrollment_id ────────────────────────────────────────
exports.getByEnrollment = async (req, res, next) => {
  try {
    const { enrollment_id } = req.params;
    const { from, to } = req.query;
    const schoolId = req.user.school_id;

    // 1. Verify ownership first
    const [[enrollmentCheck]] = await sequelize.query(`
      SELECT e.id FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE e.id = :eid AND s.school_id = :schoolId
    `, { replacements: { eid: enrollment_id, schoolId } });

    if (!enrollmentCheck) {
      return res.fail('Enrollment not found or access denied.', [], 404);
    }

    // 2. Build filter and fetch records
    let dateFilter = '';
    const replacements = { eid: enrollment_id, schoolId };

    if (from && to) {
      dateFilter = 'AND a.date BETWEEN :from AND :to';
      replacements.from = from;
      replacements.to = to;
    }

    const [records] = await sequelize.query(`
      SELECT a.id, a.date, a.status, a.method, a.marked_at, a.override_reason
      FROM attendance a
      JOIN enrollments e ON e.id = a.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE a.enrollment_id = :eid 
        AND s.school_id = :schoolId
        ${dateFilter}
      ORDER BY a.date DESC;
    `, { replacements });

    const stats = await getAttendancePercent(parseInt(enrollment_id));

    res.ok({ records, summary: stats }, `${records.length} attendance record(s) retrieved.`);
  } catch (err) { next(err); }
};

// ── GET /api/attendance/report/:session_id ────────────────────────────────────
exports.sessionReport = async (req, res, next) => {
  try {
    const { session_id } = req.params;
    const parsedSessionId = parseOptionalInteger(session_id);
    const parsedClassId = parseOptionalInteger(req.query.class_id);
    const parsedSectionId = parseOptionalInteger(req.query.section_id);

    if (parsedSessionId == null) {
      return res.fail('session_id must be a valid integer.', [], 422);
    }

    const [rows] = await sequelize.query(`
      WITH attendance_records AS (
        SELECT
          a.enrollment_id,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', a.id,
                'date', a.date,
                'status', a.status,
                'method', a.method,
                'override_reason', a.override_reason
              )
              ORDER BY a.date
            ),
            '[]'::json
          ) AS attendance
        FROM attendance a
        JOIN enrollments e ON e.id = a.enrollment_id AND e.session_id = :session_id
        GROUP BY a.enrollment_id
      ),
      attendance_summary AS (
        SELECT
          a.enrollment_id,
          COUNT(*) FILTER (WHERE a.status = 'present') AS present,
          COUNT(*) FILTER (WHERE a.status = 'absent') AS absent,
          COUNT(*) FILTER (WHERE a.status = 'late') AS late,
          COUNT(*) FILTER (WHERE a.status = 'half_day') AS half_day,
          COUNT(*) FILTER (WHERE a.status = 'holiday') AS holiday,
          ROUND(
            (
              (
                COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))
                + COUNT(*) FILTER (WHERE a.status = 'half_day') * 0.5
              )::numeric
              / NULLIF((COUNT(*) FILTER (WHERE a.status != 'holiday'))::numeric, 0)
            ) * 100,
            2
          ) AS percentage
        FROM attendance a
        JOIN enrollments e ON e.id = a.enrollment_id AND e.session_id = :session_id
        GROUP BY a.enrollment_id
      )
      SELECT
        e.id AS enrollment_id,
        s.admission_no,
        s.first_name,
        s.last_name,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class,
        sec.name AS section,
        e.roll_number,
        COALESCE(ar.attendance, '[]'::json) AS attendance,
        COALESCE(ats.present, 0) AS present,
        COALESCE(ats.absent, 0) AS absent,
        COALESCE(ats.late, 0) AS late,
        COALESCE(ats.half_day, 0) AS half_day,
        COALESCE(ats.holiday, 0) AS holiday,
        COALESCE(ats.percentage, 0) AS percentage
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN attendance_records ar ON ar.enrollment_id = e.id
      LEFT JOIN attendance_summary ats ON ats.enrollment_id = e.id
      WHERE e.session_id = :session_id
        AND e.status = 'active'
        AND (:class_id IS NULL OR e.class_id = :class_id)
        AND (:section_id IS NULL OR e.section_id = :section_id)
      ORDER BY
        c.order_number,
        sec.name,
        COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer,
        e.roll_number,
        s.admission_no;
    `, {
      replacements: {
        session_id: parsedSessionId,
        class_id: parsedClassId,
        section_id: parsedSectionId,
      },
    });

    res.ok(rows, `Attendance report for ${rows.length} student(s).`);
  } catch (err) { next(err); }
};

// ── PATCH /api/attendance/:id ─────────────────────────────────────────────────
exports.override = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, override_reason } = req.body;

    // 1. Fetch current status for audit log
    const [[current]] = await sequelize.query(`
      SELECT id, status FROM attendance
      WHERE id = :id
        AND enrollment_id IN (
          SELECT e.id FROM enrollments e
          JOIN sessions sess ON sess.id = e.session_id
          WHERE sess.school_id = :schoolId
        )
      LIMIT 1;
    `, { replacements: { id, schoolId: req.user.school_id } });

    if (!current) return res.fail('Attendance record not found or access denied.', [], 404);

    // 2. Perform update
    const [[updated]] = await sequelize.query(`
      UPDATE attendance SET
        status          = :status,
        override_reason = :reason,
        marked_by       = :markedBy,
        marked_at       = NOW(),
        updated_at      = NOW()
      WHERE id = :id
      RETURNING id, enrollment_id, date, status, override_reason;
    `, { replacements: { status, reason: override_reason, markedBy: req.user.id, id } });

    // 3. Log real previous status
    await writeAuditLog(sequelize, {
      tableName: 'attendance',
      recordId: updated.id,
      changes: { field: 'status', oldValue: current.status, newValue: status },
      changedBy: req.user.id,
      reason: `Manual override: ${override_reason}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    res.ok(updated, 'Attendance overridden.');
    invalidateCache(req.user.school_id, '/api/attendance*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

// ── NEW: Attendance Summary Report PDF ──────────────────────────────────────
exports.downloadSummaryReportPdf = async (req, res, next) => {
  try {
    const { session_id, class_id, section_id, from_date, to_date } = req.query;
    const schoolId = req.user.school_id;

    if (!session_id || !class_id || !section_id || !from_date || !to_date) {
      return res.fail('Missing required parameters.');
    }

    const [[school]] = await sequelize.query(`SELECT name, address, phone FROM schools WHERE id = :schoolId LIMIT 1`, { replacements: { schoolId } });
    if (!school) return res.fail('School record not found.');

    const [[meta]] = await sequelize.query(`
      SELECT c.name AS class_name, sec.name AS section_name, sess.name AS session_name
      FROM classes c
      JOIN sections sec ON sec.id = :sectionId AND sec.class_id = c.id
      JOIN sessions sess ON sess.id = :sessionId
      WHERE c.id = :classId LIMIT 1;
    `, { replacements: { classId: class_id, sectionId: section_id, sessionId: session_id } });

    if (!meta) return res.fail('Class, section, or session metadata not found.');

    // Helper: formatINR with Rs. (Shared PDF Rule)
    const formatINR = (amount) =>
      'Rs.' + Number(amount || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const [rows] = await sequelize.query(`
      SELECT
        e.roll_number,
        s.first_name, s.last_name,
        COUNT(*) FILTER (WHERE a.status = 'present') AS present,
        COUNT(*) FILTER (WHERE a.status = 'absent')  AS absent,
        COUNT(*) FILTER (WHERE a.status = 'late')    AS late,
        COUNT(*) FILTER (WHERE a.status = 'half_day') AS half_day,
        COUNT(*) FILTER (WHERE a.status NOT IN ('holiday')) AS total_days,
        ROUND(
          (COUNT(*) FILTER (WHERE a.status IN ('present','late'))
           + COUNT(*) FILTER (WHERE a.status = 'half_day') * 0.5
          )::numeric
          / NULLIF(COUNT(*) FILTER (WHERE a.status NOT IN ('holiday'))::numeric, 0)
          * 100, 1
        ) AS percentage
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN attendance a ON a.enrollment_id = e.id
        AND a.date BETWEEN :fromDate AND :toDate
      WHERE e.session_id = :sessionId
        AND e.class_id = :classId
        AND e.section_id = :sectionId
        AND e.status = 'active'
      GROUP BY e.id, e.roll_number, s.first_name, s.last_name
      ORDER BY COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D','','g'),''),'999999')::int, s.first_name
    `, { replacements: { fromDate: from_date, toDate: to_date, sessionId: session_id, classId: class_id, sectionId: section_id } });

    if (!rows || rows.length === 0) {
      return res.fail('No active enrollments found for the selected criteria.');
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    // Override bottom margin specifically for the footer safety
    doc.page.margins.bottom = 10;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Attendance_Report_${meta.class_name}_${meta.section_name}_${from_date}.pdf"`);
    doc.pipe(res);

    const drawHeader = () => {
      const pageWidth = doc.page.width;
      const margin = 40;
      const contentWidth = pageWidth - (margin * 2);
      
      // Header Background (Not full bleed for better printing)
      doc.rect(margin, 20, contentWidth, 80).fill('#1e40af');
      
      doc.fillColor('white').font('Helvetica-Bold').fontSize(16).text(school.name.toUpperCase(), margin + 15, 35);
      doc.font('Helvetica').fontSize(8).text(`${school.address || ''} | Phone: ${school.phone || ''}`, margin + 15, 54);
      doc.font('Helvetica-Bold').fontSize(12).text('ATTENDANCE SUMMARY REPORT', margin + 15, 72);
      
      doc.font('Helvetica').fontSize(9).text(`From: ${new Date(from_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}  To: ${new Date(to_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, margin + 15, 87);
      doc.text(`Class: ${meta.class_name} | Section: ${meta.section_name}`, margin + 250, 87);
      
      doc.fontSize(7).text(`Generated on: ${new Date().toLocaleString()}`, margin, 35, { align: 'right', width: contentWidth - 15 });
    };

    drawHeader();
    doc.y = 110;

    // Summary Stats Bar
    const totalStudents = rows.length;
    const avgPct = (rows.reduce((acc, r) => acc + parseFloat(r.percentage || 0), 0) / (totalStudents || 1)).toFixed(1);
    const perfectAtt = rows.filter(r => parseFloat(r.percentage) >= 100).length;
    const below75 = rows.filter(r => parseFloat(r.percentage) < 75).length;

    doc.fillColor('#dbeafe').rect(40, doc.y, 515, 44).fill();
    doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(14);
    
    const statBoxWidth = 515 / 4;
    let curX = 40;
    
    const drawStat = (val, label, x) => {
      doc.text(val, x, doc.y + 8, { width: statBoxWidth, align: 'center' });
      doc.font('Helvetica').fontSize(8).text(label, x, doc.y + 24, { width: statBoxWidth, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(14);
    };

    drawStat(totalStudents, 'Total Students', curX); curX += statBoxWidth;
    drawStat(`${avgPct}%`, 'Avg Attendance %', curX); curX += statBoxWidth;
    drawStat(perfectAtt, 'Perfect Attendance', curX); curX += statBoxWidth;
    drawStat(below75, 'Below 75%', curX);

    doc.y += 60;

    // Table
    const colWidths = [40, 160, 45, 45, 40, 40, 45, 60];
    const headers = ['Roll', 'Student Name', 'P', 'A', 'L', 'HD', 'Days', '%'];

    const drawTableHeaders = () => {
      doc.fillColor('#dbeafe').rect(40, doc.y, 515, 22).fill();
      doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(9);
      let tx = 40;
      headers.forEach((h, i) => {
        const align = i > 1 ? 'right' : 'left';
        doc.text(h, tx + 5, doc.y + 7, { width: colWidths[i] - 10, align });
        tx += colWidths[i];
      });
      doc.y += 22;
    };

    drawTableHeaders();

    rows.forEach((row, i) => {
      const rowHeight = 22;
      // Portrait A4 is 841.89 high. Margin 10 means bottom is 831.89.
      // Footer at 25 means text starts at 816.
      if (doc.y + rowHeight > 780) {
        doc.addPage();
        drawHeader();
        doc.y = 110;
        drawTableHeaders();
      }

      const rowY = doc.y;
      const pct = parseFloat(row.percentage || 0);
      const isLow = pct < 75;

      if (isLow) doc.fillColor('#fef2f2').rect(40, rowY, 515, rowHeight).fill();
      else if (i % 2 === 1) doc.fillColor('#f8fafc').rect(40, rowY, 515, rowHeight).fill();

      doc.fillColor('#1e293b').font('Helvetica').fontSize(9);
      let rx = 40;
      doc.text(row.roll_number || '-', rx + 5, rowY + 7); rx += colWidths[0];
      doc.text(`${row.first_name} ${row.last_name}`, rx + 5, rowY + 7, { width: colWidths[1] - 10 }); rx += colWidths[1];
      doc.text(row.present, rx + 5, rowY + 7, { width: colWidths[2] - 10, align: 'right' }); rx += colWidths[2];
      doc.text(row.absent, rx + 5, rowY + 7, { width: colWidths[3] - 10, align: 'right' }); rx += colWidths[3];
      doc.text(row.late, rx + 5, rowY + 7, { width: colWidths[4] - 10, align: 'right' }); rx += colWidths[4];
      doc.text(row.half_day, rx + 5, rowY + 7, { width: colWidths[5] - 10, align: 'right' }); rx += colWidths[5];
      doc.text(row.total_days, rx + 5, rowY + 7, { width: colWidths[6] - 10, align: 'right' }); rx += colWidths[6];


      let pctColor = '#15803d';
      if (pct < 75) pctColor = '#b91c1c';
      else if (pct < 90) pctColor = '#b45309';

      doc.fillColor(pctColor).font('Helvetica-Bold').text(`${pct}%`, rx + 5, rowY + 7, { width: colWidths[7] - 10, align: 'right' });
      
      doc.y = rowY + rowHeight;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#64748b').fontSize(8).font('Helvetica');
      doc.text('P: Present  A: Absent  L: Late  HD: Half Day', 40, doc.page.height - 25, { lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, 450, doc.page.height - 25, { align: 'right', width: 100, lineBreak: false });
    }

    doc.end();
  } catch (err) { next(err); }
};

// ── NEW: Individual Student Attendance Card PDF ────────────────────────────
exports.downloadStudentCardPdf = async (req, res, next) => {
  try {
    const { enrollment_id, from_date, to_date } = req.query;
    const schoolId = req.user.school_id;

    if (!enrollment_id || !from_date || !to_date) return res.fail('Missing parameters.');

    const [[school]] = await sequelize.query(`SELECT name, address, phone FROM schools WHERE id = :schoolId LIMIT 1`, { replacements: { schoolId } });
    if (!school) return res.fail('School record not found.');

    const [[student]] = await sequelize.query(`
      SELECT 
        s.first_name, s.last_name, s.admission_no, 
        c.name AS class_name, sec.name AS section_name,
        sp.photo_path,
        e.session_id
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN student_profiles sp ON sp.student_id = s.id AND sp.is_current = true
      WHERE e.id = :enrollmentId AND s.school_id = :schoolId LIMIT 1
    `, { replacements: { enrollmentId: enrollment_id, schoolId } });

    if (!student) return res.fail('Student enrollment record not found or access denied.', [], 404);

    const [records] = await sequelize.query(`
      SELECT date, status FROM attendance 
      WHERE enrollment_id = :enrollmentId AND date BETWEEN :fromDate AND :toDate
      ORDER BY date ASC
    `, { replacements: { enrollmentId: enrollment_id, fromDate: from_date, toDate: to_date } });

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    doc.page.margins.bottom = 10;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Attendance_${student.first_name}.pdf"`);
    doc.pipe(res);

    const drawHeader = () => {
      const pageWidth = doc.page.width;
      const margin = 40;
      const contentWidth = pageWidth - (margin * 2);
      doc.rect(margin, 20, contentWidth, 80).fill('#1e40af');
      doc.fillColor('white').font('Helvetica-Bold').fontSize(16).text(school.name.toUpperCase(), margin + 15, 35);
      doc.font('Helvetica-Bold').fontSize(12).text('STUDENT ATTENDANCE RECORD', margin + 15, 62);
      doc.fontSize(7).text(`Generated on: ${new Date().toLocaleString()}`, margin, 35, { align: 'right', width: contentWidth - 15 });
    };

    drawHeader();

    // Student Info Card
    doc.fillColor('#f8fafc').rect(40, 110, 515, 100).fill().stroke('#e2e8f0');
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(14).text(`${student.first_name} ${student.last_name}`, 60, 125);
    doc.font('Helvetica').fontSize(10).text(`Admission No: ${student.admission_no}`, 60, 145);
    doc.text(`Class: ${student.class_name} (${student.section_name})`, 60, 160);
    doc.text(`Period: ${from_date} to ${to_date}`, 60, 175);

    // Calculate Stats for Period
    const months = {};
    let totalWorking = 0;
    let totalEffective = 0;

    records.forEach(r => {
      const m = new Date(r.date).toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!months[m]) months[m] = { present: 0, absent: 0, late: 0, half_day: 0, working: 0 };
      if (r.status !== 'holiday') {
        months[m].working++;
        totalWorking++;
      }
      if (r.status === 'present') { months[m].present++; totalEffective += 1; }
      else if (r.status === 'late') { months[m].late++; totalEffective += 1; }
      else if (r.status === 'absent') { months[m].absent++; }
      else if (r.status === 'half_day') { months[m].half_day++; totalEffective += 0.5; }
    });

    const periodPct = totalWorking > 0 ? (totalEffective / totalWorking) * 100 : 0;

    // Stats Ring (Period Specific)
    const ringX = 480, ringY = 160, radius = 36;
    doc.save();
    doc.lineWidth(8).strokeColor('#f1f5f9').circle(ringX, ringY, radius).stroke();
    let ringColor = '#15803d';
    if (periodPct < 75) ringColor = '#b91c1c';
    else if (periodPct < 90) ringColor = '#b45309';

    const endAngle = (periodPct / 100) * 360;
    doc.lineWidth(8).strokeColor(ringColor).arc(ringX, ringY, radius, -90, (endAngle - 90)).stroke();
    doc.restore();
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(16).text(`${periodPct.toFixed(0)}%`, ringX - 30, ringY - 8, { width: 60, align: 'center' });

    // Monthly Breakdown Table
    doc.y = 230;
    doc.fillColor('#1e40af').font('Helvetica-Bold').fontSize(12).text('Monthly Breakdown', 40, doc.y);
    doc.moveDown(0.5);

    const mCols = [140, 60, 60, 60, 60, 75, 60];
    const mHeaders = ['Month', 'P', 'A', 'L', 'HD', 'Working', '%'];
    const tableY = doc.y;
    
    doc.fillColor('#dbeafe').rect(40, tableY, 515, 20).fill();
    doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(9);
    let mx = 40;
    mHeaders.forEach((h, i) => { 
      doc.text(h, mx + 5, tableY + 6, { width: mCols[i] - 10, align: i > 0 ? 'right' : 'left', lineBreak: false }); 
      mx += mCols[i]; 
    });
    doc.y = tableY + 20;

    Object.entries(months).forEach(([name, data], i) => {
      const rowY = doc.y;
      if (i % 2 === 1) doc.fillColor('#f8fafc').rect(40, rowY, 515, 20).fill();
      doc.fillColor('#1e293b').font('Helvetica').fontSize(9);
      
      const effective = data.present + data.late + (data.half_day * 0.5);
      const mPct = data.working > 0 ? ((effective / data.working) * 100).toFixed(1) : '0.0';
      
      let rx = 40;
      doc.text(name, rx + 5, rowY + 6, { lineBreak: false }); rx += mCols[0];
      doc.text(data.present, rx + 5, rowY + 6, { width: mCols[1] - 10, align: 'right', lineBreak: false }); rx += mCols[1];
      doc.text(data.absent, rx + 5, rowY + 6, { width: mCols[2] - 10, align: 'right', lineBreak: false }); rx += mCols[2];
      doc.text(data.late, rx + 5, rowY + 6, { width: mCols[3] - 10, align: 'right', lineBreak: false }); rx += mCols[3];
      doc.text(data.half_day, rx + 5, rowY + 6, { width: mCols[4] - 10, align: 'right', lineBreak: false }); rx += mCols[4];
      doc.text(data.working, rx + 5, rowY + 6, { width: mCols[5] - 10, align: 'right', lineBreak: false }); rx += mCols[5];
      doc.font('Helvetica-Bold').text(`${mPct}%`, rx + 5, rowY + 6, { width: mCols[6] - 10, align: 'right', lineBreak: false });
      doc.y = rowY + 20;
    });

    // Attendance Calendar
    doc.moveDown(1.5);
    const calendarSectionY = doc.y;
    doc.fillColor('#1e40af').font('Helvetica-Bold').fontSize(12).text('Attendance Calendar', 40, calendarSectionY);
    doc.moveDown(0.5);

    const monthList = [...new Set(records.map(r => new Date(r.date).toISOString().slice(0, 7)))];
    
    for (const mStr of monthList) {
      if (doc.y > 600) { doc.addPage(); drawHeader(); doc.y = 120; }
      
      const [y, m] = mStr.split('-').map(Number);
      const mName = new Date(y, m - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
      const currentMonthY = doc.y;

      doc.fillColor('#475569').font('Helvetica-Bold').fontSize(10).text(mName, 40, currentMonthY);
      doc.y = currentMonthY + 15;
      
      const firstDay = new Date(y, m - 1, 1).getDay();
      const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;
      const daysInMonth = new Date(y, m, 0).getDate();
      
      const dayHeaders = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b');
      const headerY = doc.y;
      dayHeaders.forEach((h, i) => {
        doc.text(h, 40 + i * 22, headerY, { width: 22, align: 'center', lineBreak: false });
      });
      
      doc.y = headerY + 15;
      let gridX = 40, currentX = gridX + adjustedFirstDay * 22, currentY = doc.y;

      for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const rec = records.find(r => r.date === dStr);
        
        let color = '#f1f5f9';
        if (rec) {
          if (rec.status === 'present') color = '#dcfce7';
          else if (rec.status === 'late') color = '#fef3c7';
          else if (rec.status === 'absent') color = '#fee2e2';
          else if (rec.status === 'half_day') color = '#dbeafe';
          else if (rec.status === 'holiday') color = '#f1f5f9';
        }
        
        doc.rect(currentX + 2, currentY + 2, 18, 18).fill(color);
        doc.fillColor('#94a3b8').fontSize(6).font('Helvetica').text(d, currentX + 4, currentY + 4, { lineBreak: false });
        
        if ((adjustedFirstDay + d) % 7 === 0) {
          currentX = gridX;
          currentY += 22;
        } else {
          currentX += 22;
        }
      }
      doc.y = currentY + 35;
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#64748b').fontSize(8).font('Helvetica');
      doc.text('P: Present  A: Absent  L: Late  HD: Half Day', 40, doc.page.height - 25, { lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, 450, doc.page.height - 25, { align: 'right', width: 100, lineBreak: false });
    }

    doc.end();
  } catch (err) { next(err); }
};
