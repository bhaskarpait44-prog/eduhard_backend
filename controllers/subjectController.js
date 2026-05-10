'use strict';

const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { Class, Subject } = require('../models');
const { writeAuditLog, diffFields } = require('../utils/writeAuditLog');

const auditCtx = (req) => ({
  changedBy: req.user?.id || null,
  ipAddress: req.ip || null,
  deviceInfo: req.headers['user-agent'] || null,
});

const toNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function normalizeSubjectPayload(input, isCreate = false) {
  const payload = { ...input };
  const subjectType = payload.subject_type || 'theory';

  const normalized = {
    name: payload.name?.trim(),
    code: payload.code?.trim()?.toUpperCase(),
    subject_type: subjectType,
    is_core: payload.is_core !== undefined ? Boolean(payload.is_core) : true,
    order_number: payload.order_number !== undefined ? Number(payload.order_number) : undefined,
    description: payload.description?.trim() || null,
    theory_total_marks: toNumberOrNull(payload.theory_total_marks),
    theory_passing_marks: toNumberOrNull(payload.theory_passing_marks),
    practical_total_marks: toNumberOrNull(payload.practical_total_marks),
    practical_passing_marks: toNumberOrNull(payload.practical_passing_marks),
    is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true,
  };

  if (isCreate && !normalized.order_number) normalized.order_number = 1;

  if (!['theory', 'practical', 'both'].includes(subjectType)) {
    const error = new Error('subject_type must be one of theory, practical, both.');
    error.status = 422;
    throw error;
  }

  if (subjectType === 'theory') {
    normalized.practical_total_marks = null;
    normalized.practical_passing_marks = null;
    if (normalized.theory_total_marks == null || normalized.theory_passing_marks == null) {
      const error = new Error('Theory total and passing marks are required for theory subjects.');
      error.status = 422;
      throw error;
    }
  }

  if (subjectType === 'practical') {
    normalized.theory_total_marks = null;
    normalized.theory_passing_marks = null;
    if (normalized.practical_total_marks == null || normalized.practical_passing_marks == null) {
      const error = new Error('Practical total and passing marks are required for practical subjects.');
      error.status = 422;
      throw error;
    }
  }

  if (subjectType === 'both') {
    if (
      normalized.theory_total_marks == null ||
      normalized.theory_passing_marks == null ||
      normalized.practical_total_marks == null ||
      normalized.practical_passing_marks == null
    ) {
      const error = new Error('Theory and practical marks are required when subject type is both.');
      error.status = 422;
      throw error;
    }
  }

  if (
    normalized.theory_total_marks != null &&
    normalized.theory_passing_marks != null &&
    normalized.theory_passing_marks >= normalized.theory_total_marks
  ) {
    const error = new Error('Theory passing marks must be less than theory total marks.');
    error.status = 422;
    throw error;
  }

  if (
    normalized.practical_total_marks != null &&
    normalized.practical_passing_marks != null &&
    normalized.practical_passing_marks >= normalized.practical_total_marks
  ) {
    const error = new Error('Practical passing marks must be less than practical total marks.');
    error.status = 422;
    throw error;
  }

  const combinedTotal = (normalized.theory_total_marks || 0) + (normalized.practical_total_marks || 0);
  const combinedPassing = (normalized.theory_passing_marks || 0) + (normalized.practical_passing_marks || 0);

  if (combinedTotal <= 0 || combinedPassing <= 0 || combinedPassing > combinedTotal) {
    const error = new Error('Invalid combined marks configuration.');
    error.status = 422;
    throw error;
  }

  normalized.combined_total_marks = combinedTotal;
  normalized.combined_passing_marks = combinedPassing;

  // Keep legacy fields populated for backward-compatible reads.
  normalized.total_marks = combinedTotal;
  normalized.passing_marks = combinedPassing;

  return normalized;
}

async function ensureClass(req, classId) {
  return Class.findOne({
    where: {
      id: classId,
      school_id: req.user.school_id,
      is_deleted: false,
    },
  });
}

exports.list = async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    const cls = await ensureClass(req, classId);
    if (!cls) return res.fail('Class not found.', [], 404);

    const subjects = await Subject.findAll({
      where: { class_id: classId, is_deleted: false },
      order: [['order_number', 'ASC'], ['id', 'ASC']],
    });

    return res.ok(subjects);
  } catch (err) { next(err); }
};

exports.getById = async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    const id = Number(req.params.id);

    const cls = await ensureClass(req, classId);
    if (!cls) return res.fail('Class not found.', [], 404);

    const subject = await Subject.findOne({
      where: { id, class_id: classId, is_deleted: false },
    });
    if (!subject) return res.fail('Subject not found.', [], 404);

    return res.ok(subject);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    const cls = await ensureClass(req, classId);
    if (!cls) return res.fail('Class not found.', [], 404);

    const normalized = normalizeSubjectPayload(req.body, true);

    const codeConflict = await Subject.findOne({
      where: {
        class_id: classId,
        is_deleted: false,
        code: normalized.code,
      },
    });
    if (codeConflict) return res.fail(`Subject code "${normalized.code}" already exists in this class.`, [], 409);

    const nameConflict = await Subject.findOne({
      where: {
        class_id: classId,
        is_deleted: false,
        name: normalized.name,
      },
    });
    if (nameConflict) return res.fail(`Subject "${normalized.name}" already exists in this class.`, [], 409);

    if (!normalized.order_number || normalized.order_number < 1) {
      const last = await Subject.findOne({
        where: { class_id: classId, is_deleted: false },
        order: [['order_number', 'DESC']],
      });
      normalized.order_number = (last?.order_number || 0) + 1;
    }

    const subject = await Subject.create({
      ...normalized,
      class_id: classId,
      created_by: req.user.id,
      updated_by: req.user.id,
    });

    await writeAuditLog(sequelize, {
      tableName: 'subjects',
      recordId: subject.id,
      changes: [
        { field: 'name', oldValue: null, newValue: subject.name },
        { field: 'code', oldValue: null, newValue: subject.code },
        { field: 'subject_type', oldValue: null, newValue: subject.subject_type },
        { field: 'combined_total_marks', oldValue: null, newValue: subject.combined_total_marks },
        { field: 'combined_passing_marks', oldValue: null, newValue: subject.combined_passing_marks },
      ],
      reason: 'Subject created',
      ...auditCtx(req),
    });

    return res.ok(subject, 'Subject created successfully.', 201);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    const id = Number(req.params.id);
    const { reason, ...updates } = req.body;

    const cls = await ensureClass(req, classId);
    if (!cls) return res.fail('Class not found.', [], 404);

    const subject = await Subject.findOne({
      where: { id, class_id: classId, is_deleted: false },
    });
    if (!subject) return res.fail('Subject not found.', [], 404);

    const normalized = normalizeSubjectPayload({ ...subject.toJSON(), ...updates });

    if (normalized.code && normalized.code !== subject.code) {
      const conflict = await Subject.findOne({
        where: {
          class_id: classId,
          is_deleted: false,
          code: normalized.code,
          id: { [Op.ne]: id },
        },
      });
      if (conflict) return res.fail(`Subject code "${normalized.code}" already exists in this class.`, [], 409);
    }

    if (normalized.name && normalized.name !== subject.name) {
      const conflict = await Subject.findOne({
        where: {
          class_id: classId,
          is_deleted: false,
          name: normalized.name,
          id: { [Op.ne]: id },
        },
      });
      if (conflict) return res.fail(`Subject "${normalized.name}" already exists in this class.`, [], 409);
    }

    const watchFields = [
      'name', 'code', 'subject_type', 'is_core', 'order_number', 'description',
      'theory_total_marks', 'theory_passing_marks', 'practical_total_marks', 'practical_passing_marks',
      'combined_total_marks', 'combined_passing_marks', 'is_active',
    ];
    const changes = diffFields(subject.toJSON(), normalized, watchFields);

    await subject.update({ ...normalized, updated_by: req.user.id });

    if (changes.length > 0) {
      await writeAuditLog(sequelize, {
        tableName: 'subjects',
        recordId: subject.id,
        changes,
        reason: reason || 'Subject updated',
        ...auditCtx(req),
      });
    }

    return res.ok(subject, 'Subject updated successfully.');
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    const id = Number(req.params.id);

    const cls = await ensureClass(req, classId);
    if (!cls) return res.fail('Class not found.', [], 404);

    const subject = await Subject.findOne({
      where: { id, class_id: classId, is_deleted: false },
    });
    if (!subject) return res.fail('Subject not found.', [], 404);

    const [[resultRow]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM exam_results WHERE subject_id = :subjectId;`,
      { replacements: { subjectId: id } }
    );
    const resultCount = Number(resultRow?.cnt || 0);
    if (resultCount > 0) {
      return res.fail(
        'Cannot delete this subject because exam marks are already entered for it.',
        [{ code: 'SUBJECT_IN_USE', count: resultCount }],
        400
      );
    }

    await subject.update({ is_deleted: true, updated_by: req.user.id });

    await writeAuditLog(sequelize, {
      tableName: 'subjects',
      recordId: subject.id,
      changes: [{ field: 'is_deleted', oldValue: false, newValue: true }],
      reason: req.body.reason || 'Subject deleted',
      ...auditCtx(req),
    });

    return res.ok({}, 'Subject deleted successfully.');
  } catch (err) { next(err); }
};

exports.reorder = async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    const cls = await ensureClass(req, classId);
    if (!cls) return res.fail('Class not found.', [], 404);

    const subjectOrders = Array.isArray(req.body.subject_orders) ? req.body.subject_orders : [];
    if (subjectOrders.length === 0) {
      return res.fail('subject_orders is required.', [], 422);
    }

    const ids = subjectOrders.map((row) => Number(row.id)).filter(Boolean);
    const subjects = await Subject.findAll({
      where: { class_id: classId, is_deleted: false, id: ids },
      order: [['order_number', 'ASC']],
    });

    if (subjects.length !== ids.length) {
      return res.fail('One or more subjects do not belong to this class.', [], 422);
    }

    await sequelize.transaction(async (t) => {
      for (let i = 0; i < subjectOrders.length; i += 1) {
        const row = subjectOrders[i];
        const orderNumber = Number(row.order_number) || i + 1;
        await Subject.update(
          { order_number: orderNumber, updated_by: req.user.id },
          { where: { id: Number(row.id), class_id: classId }, transaction: t }
        );
      }
    });

    const reordered = await Subject.findAll({
      where: { class_id: classId, is_deleted: false },
      order: [['order_number', 'ASC'], ['id', 'ASC']],
    });

    return res.ok(reordered, 'Subjects reordered successfully.');
  } catch (err) { next(err); }
};
