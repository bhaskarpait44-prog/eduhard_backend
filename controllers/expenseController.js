'use strict';

const sequelize = require('../config/database');

exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { month, year } = req.query;

    let dateFilter = '';
    const replacements = { schoolId };

    if (month && year) {
      const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const toDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      dateFilter = 'AND e.date BETWEEN :fromDate AND :toDate';
      replacements.fromDate = fromDate;
      replacements.toDate = toDate;
    }

    const [expenses] = await sequelize.query(`
      SELECT 
        e.id, e.category, e.amount, e.date, e.description, e.payment_mode, e.status, e.created_at,
        u1.name AS submitted_by_name,
        u2.name AS approved_by_name
      FROM expenses e
      LEFT JOIN users u1 ON u1.id = e.submitted_by
      LEFT JOIN users u2 ON u2.id = e.approved_by
      WHERE e.school_id = :schoolId ${dateFilter}
      ORDER BY e.date DESC, e.id DESC;
    `, { replacements });

    res.ok(expenses);
  } catch (err) { next(err); }
};

exports.summary = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { month, year } = req.query;

    if (!month || !year) return res.fail('Month and year are required');

    const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const toDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [summary] = await sequelize.query(`
      SELECT category, SUM(amount) AS total
      FROM expenses
      WHERE school_id = :schoolId 
        AND date BETWEEN :fromDate AND :toDate
        AND status IN ('approved', 'paid')
      GROUP BY category
      ORDER BY total DESC;
    `, { replacements: { schoolId, fromDate, toDate } });

    res.ok(summary);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { category, amount, date, description, payment_mode } = req.body;

    const [[expense]] = await sequelize.query(`
      INSERT INTO expenses (school_id, category, amount, date, description, payment_mode, status, submitted_by, created_at, updated_at)
      VALUES (:schoolId, :category, :amount, :date, :description, :payment_mode, 'submitted', :submittedBy, NOW(), NOW())
      RETURNING *;
    `, { 
      replacements: { 
        schoolId, 
        category, 
        amount, 
        date, 
        description: description || null, 
        payment_mode: payment_mode || null, 
        submittedBy: req.user.id 
      } 
    });

    res.ok(expense, 'Expense recorded successfully.', 201);
  } catch (err) { next(err); }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const schoolId = req.user.school_id;

    if (!['approved', 'paid', 'rejected'].includes(status)) {
      return res.fail('Invalid status');
    }

    let approvedByClause = '';
    const replacements = { status, id, schoolId };

    if (status === 'approved' || status === 'paid') {
      approvedByClause = ', approved_by = :approvedBy';
      replacements.approvedBy = req.user.id;
    }

    const [[updated]] = await sequelize.query(`
      UPDATE expenses
      SET status = :status, updated_at = NOW() ${approvedByClause}
      WHERE id = :id AND school_id = :schoolId
      RETURNING *;
    `, { replacements });

    if (!updated) return res.fail('Expense not found', [], 404);

    res.ok(updated, `Expense marked as ${status}.`);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[existing]] = await sequelize.query(`
      SELECT id, status FROM expenses WHERE id = :id AND school_id = :schoolId LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!existing) return res.fail('Expense not found', [], 404);
    if (existing.status === 'paid') return res.fail('Cannot delete paid expenses', [], 400);

    await sequelize.query(`DELETE FROM expenses WHERE id = :id;`, { replacements: { id } });

    res.ok(null, 'Expense deleted successfully.');
  } catch (err) { next(err); }
};
