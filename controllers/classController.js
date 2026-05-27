'use strict';
const PDFDocument = require('pdfkit');
const sequelize = require('../config/database');
const { Class, Section, Subject, Teacher } = require('../models');
const { writeAuditLog, diffFields } = require('../utils/writeAuditLog');
const { invalidateCache } = require('../middlewares/cache');

// ── Audit context helper ──────────────────────────────────────────────────
const auditCtx = (req) => ({
  changedBy : req.user?.id   || null,
  ipAddress : req.ip         || null,
  deviceInfo: req.headers['user-agent'] || null,
});

async function currentSessionId(schoolId) {
  const [[session]] = await sequelize.query(`
    SELECT id, name
    FROM sessions
    WHERE school_id = :schoolId AND is_current = true
    ORDER BY id DESC
    LIMIT 1;
  `, { replacements: { schoolId } });

  return session || null;
}

function safeFileName(value, fallback = 'class-students') {
  return String(value || fallback)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || fallback;
}

function drawLabelValue(doc, label, value, x, y, width) {
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#475569')
    .text(label, x, y, { width });

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#0f172a')
    .text(value || '--', x, y + 12, { width });
}

function ensurePdfSpace(doc, neededHeight) {
  const marginBottom = doc.page.margins?.bottom || 20;
  if (doc.y + neededHeight <= doc.page.height - marginBottom) return;
  doc.addPage();
}

function normalizeStream(value) {
  const normalized = value ? String(value).trim().toLowerCase() : '';
  return normalized || 'regular';
}

function streamLabel(value) {
  if (!value) return '';
  const label = `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  return value === 'regular' ? label : `${label} Stream`;
}

async function findClassConflict({ schoolId, id = null, name, orderNumber, stream }) {
  const replacements = {
    schoolId,
    id,
    name: name || null,
    orderNumber: orderNumber || null,
    stream: stream || null,
  };
  const excludeCurrent = id ? 'AND id <> :id' : '';
  const streamClause = stream === 'regular'
    ? "(stream = 'regular' OR stream IS NULL)"
    : stream ? 'stream = :stream' : 'stream IS NULL';

  if (name) {
    const [[conflict]] = await sequelize.query(`
      SELECT id, name, order_number, stream
      FROM classes
      WHERE school_id = :schoolId
        AND name = :name
        AND ${streamClause}
        AND COALESCE(is_deleted, false) = false
        ${excludeCurrent}
      LIMIT 1;
    `, { replacements });

    if (conflict) return { type: 'name', row: conflict };
  }

  if (orderNumber) {
    const [[conflict]] = await sequelize.query(`
      SELECT id, name, order_number, stream
      FROM classes
      WHERE school_id = :schoolId
        AND order_number = :orderNumber
        AND ${streamClause}
        AND COALESCE(is_deleted, false) = false
        ${excludeCurrent}
      LIMIT 1;
    `, { replacements });

    if (conflict) return { type: 'order', row: conflict };
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/classes
// Returns all classes with counts per class
// ──────────────────────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { is_active } = req.query;
    const schoolId      = req.user.school_id;

    const where = { school_id: schoolId };
    if (is_active !== undefined) where.is_active = is_active === 'true';

    // Check for optional columns in classes table
    const [columns] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'classes'
        AND table_schema = CURRENT_SCHEMA()
    `);
    const columnNames = columns.map(c => c.column_name);
    const hasDisplayName = columnNames.includes('display_name');
    const hasDescription = columnNames.includes('description');
    const hasMinAge = columnNames.includes('min_age');
    const hasMaxAge = columnNames.includes('max_age');
    const hasIsDeleted = columnNames.includes('is_deleted');

    // Check for is_deleted in related tables
    const [sectionColRows] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'sections' AND table_schema = CURRENT_SCHEMA()
    `);
    const sectionHasIsDeleted = sectionColRows.map(c => c.column_name).includes('is_deleted');

    const [subjectColRows] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'subjects' AND table_schema = CURRENT_SCHEMA()
    `);
    const subjectHasIsDeleted = subjectColRows.map(c => c.column_name).includes('is_deleted');

    const [classes] = await sequelize.query(`
      SELECT
        c.id, c.name,
        ${hasDisplayName ? 'c.display_name' : 'NULL as display_name'},
        c.order_number,
        ${columnNames.includes('stream') ? 'c.stream' : 'NULL as stream'},
        ${hasMinAge ? 'c.min_age' : 'NULL as min_age'},
        ${hasMaxAge ? 'c.max_age' : 'NULL as max_age'},
        ${hasDescription ? 'c.description' : 'NULL as description'},
        ${columnNames.includes('is_active') ? 'c.is_active' : 'true as is_active'},
        c.created_at, c.updated_at,
        COUNT(DISTINCT s.id)  FILTER (WHERE ${sectionHasIsDeleted ? 's.is_deleted = false' : '1=1'}) AS section_count,
        SUM(s.capacity)       FILTER (WHERE ${sectionHasIsDeleted ? 's.is_deleted = false' : '1=1'}) AS total_capacity,
        COUNT(DISTINCT sub.id) FILTER (WHERE ${subjectHasIsDeleted ? 'sub.is_deleted = false' : '1=1'}) AS subject_count,
        COUNT(DISTINCT e.id)   FILTER (WHERE e.status = 'active') AS student_count,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', ss.id,
                'name', ss.name,
                'capacity', ss.capacity,
                'is_active', ss.is_active
              )
              ORDER BY ss.name ASC
            ),
            '[]'::jsonb
          )
          FROM sections ss
          WHERE ss.class_id = c.id
            ${sectionHasIsDeleted ? 'AND ss.is_deleted = false' : ''}
        ) AS sections
      FROM classes c
      LEFT JOIN sections    s   ON s.class_id   = c.id
      LEFT JOIN subjects    sub ON sub.class_id  = c.id
      LEFT JOIN enrollments e   ON e.class_id    = c.id
      WHERE c.school_id   = :schoolId
        ${hasIsDeleted ? 'AND c.is_deleted = false' : ''}
        ${is_active !== undefined && columnNames.includes('is_active') ? `AND c.is_active = :isActive` : ''}
      GROUP BY c.id
      ORDER BY c.order_number ASC;
    `, {
      replacements: {
        schoolId,
        isActive: is_active === 'true',
      },
    });

    // Summary stats
    const [stats] = await sequelize.query(`
      SELECT
        COUNT(DISTINCT c.id)   AS total_classes,
        COUNT(DISTINCT s.id)   AS total_sections,
        COUNT(DISTINCT sub.id) AS total_subjects,
        COUNT(DISTINCT e.id)   AS total_students
      FROM classes c
      LEFT JOIN sections    s   ON s.class_id  = c.id  AND ${sectionHasIsDeleted ? 's.is_deleted = false' : '1=1'}
      LEFT JOIN subjects    sub ON sub.class_id = c.id  AND ${subjectHasIsDeleted ? 'sub.is_deleted = false' : '1=1'}
      LEFT JOIN enrollments e   ON e.class_id   = c.id  AND e.status      = 'active'
      WHERE c.school_id = :schoolId ${hasIsDeleted ? 'AND c.is_deleted = false' : ''};
    `, { replacements: { schoolId } });

    return res.ok({ classes, stats: stats[0] });
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// POST /api/classes
// ──────────────────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { name, display_name, order_number, stream, min_age, max_age, description } = req.body;
    const schoolId = req.user.school_id;
    const normalizedStream = normalizeStream(stream);

    const conflict = await findClassConflict({
      schoolId,
      name,
      orderNumber: order_number,
      stream: normalizedStream,
    });
    if (conflict?.type === 'order') {
      const suffix = normalizedStream ? ` (${streamLabel(normalizedStream)})` : '';
      return res.fail(`Order number ${order_number}${suffix} is already used by class "${conflict.row.name}".`, [], 409);
    }
    if (conflict?.type === 'name') {
      const suffix = normalizedStream ? ` for ${streamLabel(normalizedStream)}` : '';
      return res.fail(`Class name "${name}" already exists${suffix}.`, [], 409);
    }

    const cls = await Class.create({
      school_id    : schoolId,
      name,
      display_name : display_name || null,
      order_number,
      stream       : normalizedStream,
      min_age      : min_age || null,
      max_age      : max_age || null,
      description  : description || null,
      created_by   : req.user.id,
      updated_by   : req.user.id,
    });

    await writeAuditLog(sequelize, {
      tableName : 'classes',
      recordId  : cls.id,
      changes   : [
        { field: 'name',         oldValue: null, newValue: name },
        { field: 'order_number', oldValue: null, newValue: order_number },
        { field: 'stream',       oldValue: null, newValue: normalizedStream },
        { field: 'is_active',    oldValue: null, newValue: true },
      ],
      reason: 'Class created',
      ...auditCtx(req),
    });

    invalidateCache(schoolId, '/api/classes*');
    return res.ok(cls, 'Class created successfully.', 201);
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// GET /api/classes/teachers
// Returns all users with role='teacher' for selection
// ──────────────────────────────────────────────────────────────────────────
exports.getTeachers = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const [teachers] = await sequelize.query(`
      SELECT id, CONCAT(first_name, ' ', last_name) AS name, email, employee_id, designation, profile_photo
      FROM teachers
      WHERE school_id = :schoolId AND is_active = true AND is_deleted = false
      ORDER BY first_name ASC, last_name ASC;
    `, { replacements: { schoolId } });

    return res.ok(teachers);
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// GET /api/classes/:id
// ──────────────────────────────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const cls = await Class.findOne({
      where  : { id, school_id: schoolId },
      include: [
        {
          model    : Section,
          as       : 'sections',
          where    : { is_deleted: false },
          required : false,
          attributes: ['id', 'name', 'capacity', 'is_active', 'class_teacher_id'],
          include: [
            {
              model: sequelize.models.Teacher,
              as: 'classTeacher',
              attributes: ['id', 'first_name', 'last_name', 'profile_photo'],
            }
          ]
        },
        {
          model    : Subject,
          as       : 'subjects',
          where    : { is_deleted: false },
          required : false,
          order    : [['order_number', 'ASC']],
        },
      ],
    });

    if (!cls) return res.fail('Class not found.', [], 404);

    // Enrich sections with enrolled count
    const [sectionCounts] = await sequelize.query(`
      SELECT section_id, COUNT(*) AS enrolled
      FROM enrollments
      WHERE class_id = :classId AND status = 'active'
      GROUP BY section_id;
    `, { replacements: { classId: id } });

    const countMap = {};
    sectionCounts.forEach(r => { countMap[r.section_id] = parseInt(r.enrolled); });

    const enriched = cls.toJSON();
    enriched.sections = enriched.sections.map(s => ({
      ...s,
      enrolled_count: countMap[s.id] || 0,
      class_teacher_name: s.classTeacher
        ? `${s.classTeacher.first_name} ${s.classTeacher.last_name}`.trim()
        : null,
      classTeacher: s.classTeacher ? {
        ...s.classTeacher,
        name: `${s.classTeacher.first_name} ${s.classTeacher.last_name}`.trim(),
      } : null,
    }));
    enriched.student_count = Object.values(countMap).reduce((a, b) => a + b, 0);

    return res.ok(enriched);
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// PATCH /api/classes/:id
// ──────────────────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { id }    = req.params;
    const { reason, ...updateData } = req.body;
    const schoolId  = req.user.school_id;

    const cls = await Class.findOne({ where: { id, school_id: schoolId } });
    if (!cls) return res.fail('Class not found.', [], 404);

    // Check order_number conflict if changing
    const nextOrderNumber = updateData.order_number ?? cls.order_number;
    const nextStream = normalizeStream(
      Object.prototype.hasOwnProperty.call(updateData, 'stream') ? updateData.stream : cls.stream,
    );

    const conflict = await findClassConflict({
      schoolId,
      id,
      name: updateData.name ?? cls.name,
      orderNumber: nextOrderNumber,
      stream: nextStream,
    });
    if (conflict?.type === 'order') {
      const suffix = nextStream ? ` (${streamLabel(nextStream)})` : '';
      return res.fail(`Order number ${nextOrderNumber}${suffix} already used by "${conflict.row.name}".`, [], 409);
    }
    if (conflict?.type === 'name') {
      const suffix = nextStream ? ` for ${streamLabel(nextStream)}` : '';
      return res.fail(`Class name "${updateData.name ?? cls.name}" already exists${suffix}.`, [], 409);
    }

    updateData.stream = nextStream;

    const watchFields = ['name', 'display_name', 'order_number', 'stream', 'min_age', 'max_age', 'description', 'is_active'];
    const changes     = diffFields(cls.toJSON(), updateData, watchFields);

    await cls.update({ ...updateData, updated_by: req.user.id });

    if (changes.length > 0) {
      await writeAuditLog(sequelize, {
        tableName: 'classes', recordId: cls.id, changes, reason, ...auditCtx(req),
      });
    }

    invalidateCache(schoolId, '/api/classes*');
    return res.ok(cls, 'Class updated successfully.');
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/classes/:id — soft delete
// ──────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const force = req.body.force === true || req.body.force === 'true';

    const cls = await Class.findOne({ where: { id, school_id: schoolId } });
    if (!cls) return res.fail('Class not found.', [], 404);

    // Block if active enrollments exist
    const [[{ cnt }]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM enrollments WHERE class_id = :id AND status = 'active';`,
      { replacements: { id } }
    );
    if (parseInt(cnt) > 0) {
      if (!force) {
        return res.fail(
          `Cannot delete class — ${cnt} student(s) are currently enrolled. Delete anyway to close those enrollments first.`,
          [{ code: 'ACTIVE_ENROLLMENTS', count: parseInt(cnt, 10) }],
          400
        );
      }
    }

    await sequelize.transaction(async (t) => {
      if (force && parseInt(cnt) > 0) {
        await sequelize.query(`
          UPDATE enrollments
          SET status = 'inactive',
              left_date = CURRENT_DATE,
              leaving_type = 'withdrawn',
              updated_at = NOW()
          WHERE class_id = :id
            AND status = 'active';
        `, { replacements: { id }, transaction: t });
      }

      await Section.update(
        { is_deleted: true },
        { where: { class_id: id }, transaction: t }
      );

      await Subject.update(
        { is_deleted: true, updated_by: req.user.id },
        { where: { class_id: id }, transaction: t }
      );

      await cls.update({ is_deleted: true, updated_by: req.user.id }, { transaction: t });
    });

    await writeAuditLog(sequelize, {
      tableName : 'classes',
      recordId  : cls.id,
      changes   : [{ field: 'is_deleted', oldValue: false, newValue: true }],
      reason    : req.body.reason || (force ? 'Class force deleted' : 'Class deleted'),
      ...auditCtx(req),
    });

    invalidateCache(schoolId, '/api/classes*');
    return res.ok(
      { closed_enrollments: force ? parseInt(cnt, 10) : 0 },
      force && parseInt(cnt) > 0
        ? `Class deleted successfully. ${cnt} active enrollment(s) were closed.`
        : 'Class deleted successfully.'
    );
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// PATCH /api/classes/:id/toggle — toggle is_active
// ──────────────────────────────────────────────────────────────────────────
exports.toggleActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const cls = await Class.findOne({ where: { id, school_id: schoolId } });
    if (!cls) return res.fail('Class not found.', [], 404);

    const newStatus = !cls.is_active;
    await cls.update({ is_active: newStatus, updated_by: req.user.id });

    await writeAuditLog(sequelize, {
      tableName : 'classes',
      recordId  : cls.id,
      changes   : [{ field: 'is_active', oldValue: cls.is_active, newValue: newStatus }],
      reason    : `Class ${newStatus ? 'activated' : 'deactivated'}`,
      ...auditCtx(req),
    });

    invalidateCache(schoolId, '/api/classes*');
    return res.ok(cls, `Class ${newStatus ? 'activated' : 'deactivated'} successfully.`);
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// GET /api/classes/:id/sections
// ──────────────────────────────────────────────────────────────────────────
exports.getSections = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [sections] = await sequelize.query(`
      SELECT
        s.id, s.name, s.capacity, s.is_active, s.class_teacher_id,
        CONCAT(u.first_name, ' ', u.last_name) AS class_teacher_name,
        COUNT(e.id) FILTER (WHERE e.status = 'active') AS enrolled_count
      FROM sections s
      LEFT JOIN enrollments e ON e.section_id = s.id
      LEFT JOIN teachers u ON u.id = s.class_teacher_id
      WHERE s.class_id = :classId AND s.is_deleted = false
      GROUP BY s.id, u.first_name, u.last_name
      ORDER BY s.name ASC;
    `, { replacements: { classId: id } });

    return res.ok(sections);
  } catch (err) { next(err); }
};

exports.studentsPdf = async (req, res, next) => {
  try {
    const classId = Number(req.params.id);
    const schoolId = req.user.school_id;
    const requestedSessionId = req.query.session_id ? Number(req.query.session_id) : null;
    const requestedSectionId = req.query.section_id ? Number(req.query.section_id) : null;

    const cls = await Class.findOne({
      where: { id: classId, school_id: schoolId },
      attributes: ['id', 'name', 'display_name'],
    });

    if (!cls) return res.fail('Class not found.', [], 404);

    const session = requestedSessionId
      ? await (async () => {
          const [[s]] = await sequelize.query(
            `SELECT id, name FROM sessions WHERE id = :id AND school_id = :schoolId LIMIT 1`,
            { replacements: { id: requestedSessionId, schoolId } }
          );
          return s;
        })()
      : await currentSessionId(schoolId);

    if (!session?.id) {
      return res.fail('No active session found for this school.', [], 422);
    }

    const [[school]] = await sequelize.query(
      `SELECT name FROM schools WHERE id = :schoolId LIMIT 1`,
      { replacements: { schoolId } }
    );

    const [rows] = await sequelize.query(`
      SELECT
        c.name AS class_name,
        sec.name AS section_name,
        sess.name AS session_name,
        s.id AS student_id,
        s.admission_no,
        s.first_name,
        s.last_name,
        e.roll_number,
        COALESCE(
          ARRAY_AGG(sub.name ORDER BY sub.order_number, sub.name)
          FILTER (WHERE sub.id IS NOT NULL),
          ARRAY[]::text[]
        ) AS subjects
      FROM students s
      JOIN enrollments e
        ON e.student_id = s.id
       AND e.class_id = :classId
       AND e.session_id = :sessionId
       AND e.status = 'active'
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      JOIN sessions sess ON sess.id = e.session_id
      LEFT JOIN student_subjects ss
        ON ss.student_id = s.id
       AND ss.session_id = e.session_id
       AND ss.is_active = true
      LEFT JOIN subjects sub ON sub.id = ss.subject_id
      WHERE s.school_id = :schoolId
        AND s.is_deleted = false
        ${requestedSectionId ? 'AND e.section_id = :sectionId' : ''}
      GROUP BY
        c.name, sec.name, sess.name,
        s.id, s.admission_no, s.first_name, s.last_name, e.roll_number
      ORDER BY
        sec.name ASC,
        COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\D', '', 'g'), ''), '999999')::integer ASC,
        s.first_name ASC,
        s.last_name ASC;
    `, {
      replacements: {
        classId,
        schoolId,
        sessionId: session.id,
        sectionId: requestedSectionId,
      },
    });

    const fileBase = safeFileName(`${cls.name}-student-list`);
    const filename = `${fileBase}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, left: 40, right: 40, bottom: 10 },
      bufferPages: true,
    });

    doc.pipe(res);

    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor('#0f172a')
      .text(school?.name || 'School', { align: 'center' });

    doc
      .moveDown(0.2)
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#1d4ed8')
      .text(`Class ${rows[0]?.class_name || cls.name}`, { align: 'center' });

    doc
      .moveDown(0.2)
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#64748b')
      .text(`Session: ${rows[0]?.session_name || session?.name || 'Current Session'}`, { align: 'center' });

    if (requestedSectionId) {
      const sectionName = rows[0]?.section_name || `Section ${requestedSectionId}`;
      doc.text(`Section: ${sectionName}`, { align: 'center' });
    }

    doc.moveDown(1);

    const leftX = 48;
    const cardWidth = doc.page.width - 96;
    const leftWidth = Math.floor(cardWidth * 0.42);
    const rightWidth = cardWidth - leftWidth - 18;
    const rightX = leftX + leftWidth + 18;
    const cardHeight = 172;
    const subjectCapacity = 10;

    rows.forEach((row, index) => {
      const studentName = `${row.first_name} ${row.last_name || ''}`.trim();
      const rollText = row.roll_number || '--';
      const subjectList = Array.isArray(row.subjects) ? row.subjects.filter(Boolean) : [];
      const visibleSubjects = subjectList.slice(0, subjectCapacity);
      const remainingSubjects = Math.max(0, subjectList.length - subjectCapacity);

      ensurePdfSpace(doc, cardHeight + 16);

      const top = doc.y;

      doc
        .roundedRect(leftX, top, cardWidth, cardHeight, 12)
        .lineWidth(1)
        .strokeColor('#dbeafe')
        .fillAndStroke('#ffffff', '#cbd5e1');

      doc
        .roundedRect(rightX, top + 10, rightWidth, cardHeight - 20, 10)
        .lineWidth(1)
        .strokeColor('#93c5fd')
        .stroke();

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#0f172a')
        .text(`${index + 1}. ${studentName}`, leftX + 14, top + 14, { width: leftWidth - 20 });

      drawLabelValue(doc, 'Name', studentName, leftX + 14, top + 44, leftWidth - 28);
      drawLabelValue(doc, 'Roll No', rollText, leftX + 14, top + 94, leftWidth - 28);

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#475569')
        .text(row.section_name ? `Section ${row.section_name}` : 'Student', leftX + 14, top + 138, { width: leftWidth - 20 });

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#1d4ed8')
        .text('Enrollment', rightX + 10, top + 14, { width: rightWidth - 20 });

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#0f172a')
        .text(row.admission_no || '--', rightX + 10, top + 28, { width: rightWidth - 20 });

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#1d4ed8')
        .text(`Subjects (${Math.min(subjectList.length, subjectCapacity)} / ${subjectCapacity})`, rightX + 10, top + 48, { width: rightWidth - 20 });

      let subjectY = top + 64;
      if (!visibleSubjects.length) {
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#64748b')
          .text('No subjects assigned', rightX + 10, subjectY, { width: rightWidth - 20 });
      } else {
        visibleSubjects.forEach((subject, subjectIndex) => {
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor('#334155')
            .text(`${subjectIndex + 1}. ${subject}`, rightX + 10, subjectY, { width: rightWidth - 20, lineBreak: false });
          subjectY += 10.5;
        });
      }

      if (remainingSubjects > 0) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor('#64748b')
          .text(`+${remainingSubjects} more subject(s)`, rightX + 10, top + 64 + (subjectCapacity * 10.5), { width: rightWidth - 20 });
      }

      if (index === rows.length - 1) {
        // Last card: Ensure doc.y doesn't push past usable space
        const marginBottom = doc.page.margins?.bottom || 10;
        doc.y = Math.min(top + cardHeight + 12, doc.page.height - marginBottom);
      } else {
        doc.y = top + cardHeight + 12;
      }
    });

    if (!rows.length) {
      doc
        .moveDown(2)
        .font('Helvetica')
        .fontSize(12)
        .fillColor('#64748b')
        .text('No enrolled students found for this class in the selected session.', { align: 'center' });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#94a3b8')
        .text(
          `Generated by EduCore • Page ${i - range.start + 1} of ${range.count}`,
          40,
          doc.page.height - 20,
          { align: 'center', width: doc.page.width - 80, lineBreak: false }
        );
    }

    // With bufferPages:true and manual page switching above, calling doc.end() 
    // flushes all buffered pages correctly. We don't need to switch to the last page.
    doc.end();
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// POST /api/classes/:id/sections
// ──────────────────────────────────────────────────────────────────────────
exports.createSection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, capacity, class_teacher_id } = req.body;

    const cls = await Class.findByPk(id);
    if (!cls) return res.fail('Class not found.', [], 404);

    const existing = await Section.findOne({ where: { class_id: id, name } });
    if (existing) return res.fail(`Section "${name}" already exists in this class.`, [], 409);

    const section = await Section.create({
      class_id: id,
      name,
      capacity,
      class_teacher_id: class_teacher_id || null
    });
    invalidateCache(req.user.school_id, '/api/classes*');
    return res.ok(section, 'Section added successfully.', 201);
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// PATCH /api/classes/:id/sections/:sectionId
// ──────────────────────────────────────────────────────────────────────────
exports.updateSection = async (req, res, next) => {
  try {
    const { id, sectionId } = req.params;
    const { name, capacity, is_active, class_teacher_id } = req.body;

    const section = await Section.findOne({ where: { id: sectionId, class_id: id } });
    if (!section) return res.fail('Section not found.', [], 404);

    await section.update({ name, capacity, is_active, class_teacher_id: class_teacher_id || null });
    invalidateCache(req.user.school_id, '/api/classes*');
    return res.ok(section, 'Section updated successfully.');
  } catch (err) { next(err); }
};


// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/classes/:id/sections/:sectionId
// ──────────────────────────────────────────────────────────────────────────
exports.deleteSection = async (req, res, next) => {
  try {
    const { id, sectionId } = req.params;

    const section = await Section.findOne({ where: { id: sectionId, class_id: id } });
    if (!section) return res.fail('Section not found.', [], 404);

    const [[{ cnt }]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM enrollments WHERE section_id = :sectionId AND status = 'active';`,
      { replacements: { sectionId } }
    );
    if (parseInt(cnt) > 0) {
      return res.fail(
        `Cannot delete section — ${cnt} student(s) are enrolled. Transfer students first.`,
        [], 400
      );
    }

    await section.update({ is_deleted: true });
    invalidateCache(req.user.school_id, '/api/classes*');
    return res.ok({}, 'Section deleted successfully.');
  } catch (err) { next(err); }
};