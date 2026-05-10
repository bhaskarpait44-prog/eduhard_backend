'use strict';

const sequelize = require('../config/database');
const { getAttendancePercent } = require('../utils/attendanceCalculator');

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

async function resolveSessionId({ requestedSessionId, schoolId }) {
  if (requestedSessionId != null) {
    const [[session]] = await sequelize.query(`
      SELECT id
      FROM sessions
      WHERE id = :sessionId
        AND school_id = :schoolId
      LIMIT 1;
    `, { replacements: { sessionId: requestedSessionId, schoolId } });

    return session?.id || null;
  }

  const session = await getCurrentSessionForSchool(schoolId);
  return session?.id || null;
}

// ── POST /api/attendance/mark ─────────────────────────────────────────────────
exports.markSingle = async (req, res, next) => {
  try {
    const { enrollment_id, date, status, method } = req.body;

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

    res.ok(record, 'Attendance marked.', 201);
  } catch (err) { next(err); }
};

// ── POST /api/attendance/bulk ─────────────────────────────────────────────────
exports.markBulk = async (req, res, next) => {
  try {
    const { date, records } = req.body;

    const inserted = [];
    const updated  = [];

    await sequelize.transaction(async (t) => {
      for (const rec of records) {
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

    res.ok({
      date,
      marked  : inserted.length,
      updated : updated.length,
      skipped : 0,
      updated_enrollment_ids: updated,
    }, `${inserted.length} record(s) marked. ${updated.length} updated.`);
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

exports.downloadAttendanceRegisterPdf = async (req, res, next) => {
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
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Attendance_Register_${meta.class_name}_${meta.section_name}_${month}_${year}.pdf"`);
    doc.pipe(res);

    const monthName = new Date(yearNum, monthNum - 1).toLocaleString('default', { month: 'long' });

    const drawHeader = () => {
      doc.fillColor('#0f766e').fontSize(16).font('Helvetica-Bold').text(school.name.toUpperCase(), { align: 'center' });
      doc.fillColor('#64748b').fontSize(8).font('Helvetica').text(school.address, { align: 'center' });
      doc.moveDown(0.5);
      doc.fillColor('#1e293b').fontSize(12).font('Helvetica-Bold').text(`MONTHLY ATTENDANCE REGISTER - ${monthName.toUpperCase()} ${yearNum}`, { align: 'center' });
      doc.fontSize(10).text(`Class: ${meta.class_name} (${meta.section_name}) | Session: ${meta.session_name}`, { align: 'center' });
      doc.moveDown(1);
    };

    drawHeader();

    const startX = 30;
    const nameWidth = 140;
    const rollWidth = 35;
    const dayWidth = (doc.page.width - 60 - nameWidth - rollWidth - 40) / lastDay; // Extra 40 for totals
    const rowHeight = 18;

    const drawGridHeader = (y) => {
      doc.fillColor('#f8fafc').rect(startX, y, doc.page.width - 60, rowHeight).fill();
      doc.fillColor('#475569').fontSize(7).font('Helvetica-Bold');
      doc.text('ROLL', startX + 2, y + 5, { width: rollWidth });
      doc.text('STUDENT NAME', startX + rollWidth + 5, y + 5, { width: nameWidth });
      
      for (let d = 1; d <= lastDay; d++) {
        const x = startX + rollWidth + nameWidth + (d - 1) * dayWidth;
        doc.text(d.toString(), x, y + 5, { width: dayWidth, align: 'center' });
      }
      
      doc.text('P', startX + rollWidth + nameWidth + lastDay * dayWidth + 5, y + 5, { width: 15, align: 'center' });
      doc.text('A', startX + rollWidth + nameWidth + lastDay * dayWidth + 20, y + 5, { width: 15, align: 'center' });
    };

    drawGridHeader(doc.y);
    doc.moveDown(0.1);

    students.forEach((student, index) => {
      if (doc.y > 520) {
        doc.addPage();
        drawHeader();
        drawGridHeader(doc.y);
        doc.moveDown(0.1);
      }

      const y = doc.y;
      doc.fillColor('#1e293b').fontSize(7).font('Helvetica');
      
      // Zebra striping
      if (index % 2 === 1) {
        doc.fillColor('#f1f5f9').rect(startX, y, doc.page.width - 60, rowHeight).fill();
        doc.fillColor('#1e293b');
      }

      doc.text(student.roll_number || '-', startX + 2, y + 5, { width: rollWidth });
      doc.text(`${student.first_name} ${student.last_name}`, startX + rollWidth + 5, y + 5, { width: nameWidth, lineBreak: false });

      let pCount = 0;
      let aCount = 0;

      for (let d = 1; d <= lastDay; d++) {
        const x = startX + rollWidth + nameWidth + (d - 1) * dayWidth;
        const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const record = student.records.find(r => r.date === dateStr);
        
        let char = '·';
        let color = '#94a3b8';

        if (record) {
          if (record.status === 'present' || record.status === 'late') {
            char = 'P'; color = '#15803d'; pCount++;
          } else if (record.status === 'absent') {
            char = 'A'; color = '#b91c1c'; aCount++;
          } else if (record.status === 'leave') {
            char = 'L'; color = '#d97706';
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
    doc.text('P: Present | A: Absent | L: Leave | ½: Half Day | ·: Not Marked', startX, doc.y);

    // Pagination
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.text(`Page ${i + 1} of ${range.count}`, 30, 560, { align: 'right', width: doc.page.width - 60 });
    }

    doc.end();
  } catch (err) { next(err); }
};

// ── GET /api/attendance/:enrollment_id ────────────────────────────────────────
exports.getByEnrollment = async (req, res, next) => {
  try {
    const { enrollment_id } = req.params;
    const { from, to } = req.query;

    let dateFilter = '';
    if (from && to) dateFilter = `AND a.date BETWEEN '${from}' AND '${to}'`;

    const [records] = await sequelize.query(`
      SELECT a.id, a.date, a.status, a.method, a.marked_at, a.override_reason
      FROM attendance a
      WHERE a.enrollment_id = :eid ${dateFilter}
      ORDER BY a.date DESC;
    `, { replacements: { eid: enrollment_id } });

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
        COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\D', '', 'g'), ''), '999999')::integer,
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

    if (!updated) return res.fail('Attendance record not found.', [], 404);
    res.ok(updated, 'Attendance overridden.');
  } catch (err) { next(err); }
};
