'use strict';
const PDFDocument = require('pdfkit');
const sequelize = require('../config/database');
const { Class, Section, Subject, Teacher } = require('../models');
const { writeAuditLog, diffFields } = require('../utils/writeAuditLog');
const { invalidateCache, invalidateClassCache } = require('../middlewares/cache');

// ── Audit context helper ──────────────────────────────────────────────────
const auditCtx = (req) => ({
  schoolId  : req.user?.school_id || null,
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
    .replace(/(^-)|(-$)/g, '')
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

    const [classes] = await sequelize.query(`
      SELECT
        c.id, c.name,
        c.display_name,
        c.order_number,
        c.stream,
        c.min_age,
        c.max_age,
        c.description,
        c.is_active,
        c.created_at, c.updated_at,
        COUNT(DISTINCT s.id)  FILTER (WHERE s.is_deleted = false) AS section_count,
        SUM(s.capacity)       FILTER (WHERE s.is_deleted = false) AS total_capacity,
        COUNT(DISTINCT sub.id) FILTER (WHERE sub.is_deleted = false) AS subject_count,
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
            AND ss.is_deleted = false
        ) AS sections
      FROM classes c
      LEFT JOIN sections    s   ON s.class_id   = c.id
      LEFT JOIN subjects    sub ON sub.class_id  = c.id
      LEFT JOIN enrollments e   ON e.class_id    = c.id
      WHERE c.school_id   = :schoolId
        AND c.is_deleted = false
        ${is_active !== undefined ? 'AND c.is_active = :isActive' : ''}
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
      LEFT JOIN sections    s   ON s.class_id  = c.id  AND s.is_deleted = false
      LEFT JOIN subjects    sub ON sub.class_id = c.id  AND sub.is_deleted = false
      LEFT JOIN enrollments e   ON e.class_id   = c.id  AND e.status      = 'active'
      WHERE c.school_id = :schoolId AND c.is_deleted = false;
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

    // Automatically register stream if not exists
    if (normalizedStream !== 'regular') {
      const [[validStream]] = await sequelize.query(`
        SELECT id FROM streams
        WHERE school_id = :schoolId
          AND LOWER(name) = :streamName
        LIMIT 1;
      `, { replacements: { schoolId, streamName: normalizedStream } });

      if (!validStream) {
        await sequelize.query(`
          INSERT INTO streams (school_id, name, created_at, updated_at)
          VALUES (:schoolId, :streamName, NOW(), NOW());
        `, { replacements: { schoolId, streamName: normalizedStream } });

        invalidateCache(schoolId, '/api/streams*');
      }
    }

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
          separate : true,
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

    // Normalize display_name
    if (Object.prototype.hasOwnProperty.call(updateData, 'display_name')) {
      updateData.display_name = updateData.display_name || null;
    }

    // Validate effective min/max age range to prevent chk_classes_age_range violation
    const nextMinAge = Object.prototype.hasOwnProperty.call(updateData, 'min_age')
      ? (updateData.min_age === '' || updateData.min_age === null ? null : parseInt(updateData.min_age, 10))
      : cls.min_age;
    const nextMaxAge = Object.prototype.hasOwnProperty.call(updateData, 'max_age')
      ? (updateData.max_age === '' || updateData.max_age === null ? null : parseInt(updateData.max_age, 10))
      : cls.max_age;

    if (nextMinAge !== null && nextMaxAge !== null && nextMaxAge <= nextMinAge) {
      return res.fail('Max age must be greater than min age', [], 400);
    }

    // Check order_number conflict if changing
    const nextOrderNumber = updateData.order_number ?? cls.order_number;
    const nextStream = normalizeStream(
      Object.prototype.hasOwnProperty.call(updateData, 'stream') ? updateData.stream : cls.stream,
    );

    // Automatically register stream if not exists
    if (nextStream !== 'regular') {
      const [[validStream]] = await sequelize.query(`
        SELECT id FROM streams
        WHERE school_id = :schoolId
          AND LOWER(name) = :streamName
        LIMIT 1;
      `, { replacements: { schoolId, streamName: nextStream } });

      if (!validStream) {
        await sequelize.query(`
          INSERT INTO streams (school_id, name, created_at, updated_at)
          VALUES (:schoolId, :streamName, NOW(), NOW());
        `, { replacements: { schoolId, streamName: nextStream } });

        invalidateCache(schoolId, '/api/streams*');
      }
    }

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

    invalidateClassCache(schoolId, id);
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
          `Cannot delete class — ${cnt} student(s) are currently enrolled. Resend with force=true to close these enrollments and delete the class.`,
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

    invalidateClassCache(schoolId, id);
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

    const oldStatus = cls.is_active;
    const newStatus = !oldStatus;
    await cls.update({ is_active: newStatus, updated_by: req.user.id });

    await writeAuditLog(sequelize, {
      tableName : 'classes',
      recordId  : cls.id,
      changes   : [{ field: 'is_active', oldValue: oldStatus, newValue: newStatus }],
      reason    : `Class ${newStatus ? 'activated' : 'deactivated'}`,
      ...auditCtx(req),
    });

    invalidateClassCache(schoolId, id);
    return res.ok(cls, `Class ${newStatus ? 'activated' : 'deactivated'} successfully.`);
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// GET /api/classes/:id/sections
// ──────────────────────────────────────────────────────────────────────────
exports.getSections = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    let queryStr = `
      SELECT
        s.id, s.name, s.capacity, s.is_active, s.class_teacher_id,
        c.name AS class_name,
        CONCAT(u.first_name, ' ', u.last_name) AS class_teacher_name,
        COUNT(e.id) FILTER (WHERE e.status = 'active') AS enrolled_count
      FROM sections s
      JOIN classes c ON c.id = s.class_id
      LEFT JOIN enrollments e ON e.section_id = s.id
      LEFT JOIN teachers u ON u.id = s.class_teacher_id
      WHERE c.school_id = :schoolId AND s.is_deleted = false
    `;
    const replacements = { schoolId };

    if (id !== undefined) {
      // Verify class belongs to school
      const cls = await Class.findOne({ where: { id, school_id: schoolId } });
      if (!cls) return res.fail('Class not found.', [], 404);

      queryStr += ` AND s.class_id = :classId`;
      replacements.classId = id;
    }

    queryStr += `
      GROUP BY s.id, c.name, u.first_name, u.last_name
      ORDER BY c.name ASC, s.name ASC;
    `;

    const [sections] = await sequelize.query(queryStr, { replacements });

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
          ARRAY_AGG(sub.name ORDER BY sub.order_number, sub.name) FILTER (WHERE sub.id IS NOT NULL),
          (SELECT ARRAY_AGG(name ORDER BY order_number, name) FROM subjects WHERE class_id = :classId AND is_active = true AND is_deleted = false),
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
        COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer ASC,
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
        doc.y = Math.min(top + cardHeight + 12, doc.page.height - marginBottom - 1);
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
          doc.page.height - 25,
          { align: 'center', width: doc.page.width - 80, lineBreak: false }
        );
    }

    // With bufferPages:true and manual page switching above, calling doc.end() 
    // flushes all buffered pages correctly. We don't need to switch to the last page.
    doc.end();
  } catch (err) { next(err); }
};

// ──────────────────────────────────────────────────────────────────────────
// GET /api/classes/:id/students/pdf/simple
// Simple student list with admission numbers (table format)
// ──────────────────────────────────────────────────────────────────────────
exports.simpleStudentsPdf = async (req, res, next) => {
  try {
    const classId = Number(req.params.id);
    const schoolId = req.user.school_id;
    const requestedSessionId = req.query.session_id ? Number(req.query.session_id) : null;
    const requestedSectionId = req.query.section_id ? Number(req.query.section_id) : null;

    const cls = await Class.findOne({
      where: { id: classId, school_id: schoolId },
      attributes: ['id', 'name'],
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
      return res.fail('No active session found.', [], 422);
    }

    const [[school]] = await sequelize.query(
      `SELECT name FROM schools WHERE id = :schoolId LIMIT 1`,
      { replacements: { schoolId } }
    );

    const [rows] = await sequelize.query(`
      SELECT
        c.name AS class_name,
        sec.name AS section_name,
        s.admission_no,
        s.first_name,
        s.last_name,
        e.roll_number
      FROM students s
      JOIN enrollments e
        ON e.student_id = s.id
       AND e.class_id = :classId
       AND e.session_id = :sessionId
       AND e.status = 'active'
      JOIN classes c ON c.id = e.class_id
      JOIN sections sec ON sec.id = e.section_id
      WHERE s.school_id = :schoolId
        AND s.is_deleted = false
        ${requestedSectionId ? 'AND e.section_id = :sectionId' : ''}
      ORDER BY
        sec.name ASC,
        COALESCE(NULLIF(REGEXP_REPLACE(e.roll_number, '\\D', '', 'g'), ''), '999999')::integer ASC,
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

    const fileBase = safeFileName(`${cls.name}-student-list-simple`);
    const filename = `${fileBase}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, left: 50, right: 50, bottom: 10 },
      bufferPages: true,
    });

    doc.pipe(res);

    const BRAND = '#4F46E5';
    const DARK = '#111827';
    const MUTED = '#6B7280';
    const BORDER = '#E5E7EB';
    const LIGHT = '#F9FAFB';

    // Header
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(BRAND)
      .text((school?.name || 'School').toUpperCase(), { align: 'center' });

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor(DARK)
      .text('STUDENT CLASS LIST', { align: 'center', characterSpacing: 1 });

    doc.moveDown(0.4);
    
    const subHeaderText = `Class: ${cls.name} | Session: ${session.name}${requestedSectionId && rows[0] ? ` | Section: ${rows[0].section_name}` : ''}`;
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(subHeaderText, { align: 'center' });

    doc.moveDown(1.2);

    // Table Header
    const tableTop = doc.y;
    const colAdmission = 50;
    const colRoll = 160;
    const colName = 240;
    const colSection = 480;

    // Draw header box
    doc.rect(50, tableTop - 4, 495, 20).fillAndStroke('#eff6ff', BORDER);

    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(BRAND);

    doc.text('Admission No.', colAdmission + 5, tableTop);
    doc.text('Roll No.', colRoll, tableTop);
    doc.text('Student Name', colName, tableTop);
    doc.text('Section', colSection, tableTop);

    let currentY = tableTop + 16;

    rows.forEach((row, index) => {
      // Page break check (A4 is 792 high, margin 10, so max Y is 782. 750 is safe)
      if (currentY > 750) {
        doc.addPage();
        currentY = 50;
        
        // Draw header box on next page
        doc.rect(50, currentY - 4, 495, 20).fillAndStroke('#eff6ff', BORDER);
        doc
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .fillColor(BRAND);
        doc.text('Admission No.', colAdmission + 5, currentY);
        doc.text('Roll No.', colRoll, currentY);
        doc.text('Student Name', colName, currentY);
        doc.text('Section', colSection, currentY);
        currentY += 16;
      }

      // Draw alternating row backgrounds
      if (index % 2 === 0) {
        doc.rect(50, currentY, 495, 18).fill(LIGHT);
      } else {
        doc.rect(50, currentY, 495, 18).fill('#ffffff');
      }

      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(DARK);

      const fullName = `${row.first_name} ${row.last_name || ''}`.trim();
      
      doc.text(row.admission_no || '--', colAdmission + 5, currentY + 5);
      doc.text(row.roll_number || '--', colRoll, currentY + 5);
      doc.text(`${index + 1}. ${fullName}`, colName, currentY + 5);
      doc.text(row.section_name || '--', colSection, currentY + 5);

      // Draw thin bottom border
      doc
        .moveTo(50, currentY + 18)
        .lineTo(545, currentY + 18)
        .lineWidth(0.5)
        .strokeColor(BORDER)
        .stroke();

      currentY += 18;
    });

    if (!rows.length) {
      doc.moveDown(2).fillColor(MUTED).font('Helvetica-Oblique').text('No active enrollments found.', { align: 'center' });
    }

    // Footer
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(
          `Generated on ${new Date().toLocaleDateString('en-IN')} • Page ${i + 1} of ${range.count}`,
          50,
          doc.page.height - 25,
          { align: 'center', width: doc.page.width - 100, lineBreak: false }
        );
    }

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
    const schoolId = req.user.school_id;

    // Verify class belongs to school
    const cls = await Class.findOne({ where: { id, school_id: schoolId } });
    if (!cls) return res.fail('Class not found.', [], 404);

    if (class_teacher_id) {
      const [[teacherCheck]] = await sequelize.query(`
        SELECT id FROM teachers WHERE id = :teacherId AND school_id = :schoolId AND is_deleted = false AND is_active = true LIMIT 1;
      `, { replacements: { teacherId: class_teacher_id, schoolId } });
      if (!teacherCheck) {
        return res.fail('Class teacher not found or does not belong to this school.', [], 422);
      }
    }

    const existing = await Section.findOne({ where: { class_id: id, name } });
    if (existing) return res.fail(`Section "${name}" already exists in this class.`, [], 409);

    const section = await Section.create({
      class_id: id,
      name,
      capacity,
      class_teacher_id: class_teacher_id || null
    });
    invalidateClassCache(schoolId, id);
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
    const schoolId = req.user.school_id;

    // Verify class belongs to school
    const cls = await Class.findOne({ where: { id, school_id: schoolId } });
    if (!cls) return res.fail('Class not found.', [], 404);

    const section = await Section.findOne({ where: { id: sectionId, class_id: id } });
    if (!section) return res.fail('Section not found.', [], 404);

    if (class_teacher_id) {
      const [[teacherCheck]] = await sequelize.query(`
        SELECT id FROM teachers WHERE id = :teacherId AND school_id = :schoolId AND is_deleted = false AND is_active = true LIMIT 1;
      `, { replacements: { teacherId: class_teacher_id, schoolId } });
      if (!teacherCheck) {
        return res.fail('Class teacher not found or does not belong to this school.', [], 422);
      }
    }

    const updates = { name, capacity, is_active };
    if (Object.prototype.hasOwnProperty.call(req.body, 'class_teacher_id')) {
      updates.class_teacher_id = class_teacher_id || null;
    }

    await section.update(updates);
    invalidateClassCache(schoolId, id);
    return res.ok(section, 'Section updated successfully.');
  } catch (err) { next(err); }
};


// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/classes/:id/sections/:sectionId
// ──────────────────────────────────────────────────────────────────────────
exports.deleteSection = async (req, res, next) => {
  try {
    const { id, sectionId } = req.params;
    const schoolId = req.user.school_id;

    // Verify class belongs to school
    const cls = await Class.findOne({ where: { id, school_id: schoolId } });
    if (!cls) return res.fail('Class not found.', [], 404);

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
    invalidateClassCache(schoolId, id);
    return res.ok({}, 'Section deleted successfully.');
  } catch (err) { next(err); }
};