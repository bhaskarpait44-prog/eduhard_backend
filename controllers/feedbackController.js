'use strict';

const sequelize = require('../config/database');

exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { status, type } = req.query;

    const replacements = { schoolId };
    let filter = '';

    if (status) { filter += ' AND f.status = :status'; replacements.status = status; }
    if (type) { filter += ' AND f.type = :type'; replacements.type = type; }

    // If user is not admin, only show their own feedback
    if (req.user.role !== 'admin') {
      filter += ' AND f.user_id = :userId';
      replacements.userId = req.user.id;
    }

    const [records] = await sequelize.query(`
      SELECT 
        f.*, 
        u.name AS user_name, u.role AS user_role,
        r.name AS replier_name
      FROM feedback f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN users r ON r.id = f.replied_by
      WHERE f.school_id = :schoolId ${filter}
      ORDER BY f.created_at DESC;
    `, { replacements });

    res.ok(records);
  } catch (err) { next(err); }
};

exports.submit = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const userId = req.user.id;
    const { type, subject, message } = req.body;

    if (!type || !subject || !message) {
      return res.fail('Type, subject, and message are required.');
    }

    if (!['feedback', 'complaint'].includes(type)) {
      return res.fail('Invalid feedback type.');
    }

    const [record] = await sequelize.query(`
      INSERT INTO feedback (school_id, user_id, type, subject, message, status, created_at, updated_at)
      VALUES (:schoolId, :userId, :type, :subject, :message, 'open', NOW(), NOW())
      RETURNING *
    `, { replacements: { schoolId, userId, type, subject, message } });

    // Join with user to get user_name for immediate store update
    const [[fullRecord]] = await sequelize.query(`
      SELECT f.*, u.name as user_name, u.role as user_role
      FROM feedback f
      JOIN users u ON u.id = f.user_id
      WHERE f.id = :id
    `, { replacements: { id: record[0].id } });

    res.ok(fullRecord, 'Feedback submitted successfully.', 201);
  } catch (err) { next(err); }
};

exports.reply = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { admin_reply, status } = req.body;
    const schoolId = req.user.school_id;

    if (!admin_reply) return res.fail('Reply message is required.');

    const [result] = await sequelize.query(`
      UPDATE feedback SET
        admin_reply = :admin_reply,
        status = :status,
        replied_by = :replied_by,
        replied_at = NOW(),
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
      RETURNING *
    `, { replacements: { 
      id, schoolId, admin_reply, 
      status: status || 'resolved',
      replied_by: req.user.id
    } });

    if (result.length === 0) return res.fail('Feedback record not found.', [], 404);

    // Fetch joined record to include replier_name
    const [[fullRecord]] = await sequelize.query(`
      SELECT f.*, u.name AS user_name, r.name AS replier_name
      FROM feedback f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN users r ON r.id = f.replied_by
      WHERE f.id = :id
    `, { replacements: { id: result[0].id } });

    res.ok(fullRecord, 'Reply sent.');
  } catch (err) { next(err); }
};

exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[record]] = await sequelize.query(`
      SELECT id, user_id, status FROM feedback WHERE id = :id AND school_id = :schoolId
    `, { replacements: { id, schoolId } });

    if (!record) return res.fail('Record not found.', [], 404);

    // Only allow deletion by owner if status is open, or by admin
    const isAdmin = req.user.role === 'admin';
    const isOwner = record.user_id === req.user.id;

    if (!isAdmin && (!isOwner || record.status !== 'open')) {
      return res.fail('Unauthorized or record is already being processed.', [], 403);
    }

    await sequelize.query(`DELETE FROM feedback WHERE id = :id`, { replacements: { id } });
    
    res.ok(null, 'Record deleted.');
  } catch (err) { next(err); }
};
