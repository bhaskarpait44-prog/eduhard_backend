'use strict';

const sequelize = require('../config/database');

exports.getItems = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const [items] = await sequelize.query(`
      SELECT * FROM inventory_items WHERE school_id = :schoolId ORDER BY name ASC
    `, { replacements: { schoolId } });
    res.ok(items);
  } catch (err) { next(err); }
};

exports.createItem = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { name, category, unit, reorder_level } = req.body;
    
    const [item] = await sequelize.query(`
      INSERT INTO inventory_items (school_id, name, category, unit, reorder_level, quantity, created_at, updated_at)
      VALUES (:schoolId, :name, :category, :unit, :reorder_level, 0, NOW(), NOW())
      RETURNING *
    `, { replacements: { 
      schoolId, name, category, unit, 
      reorder_level: reorder_level || 0 
    } });

    res.ok(item[0], 'Item created.', 201);
  } catch (err) { next(err); }
};

exports.updateItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { name, category, unit, reorder_level } = req.body;
    
    const [result] = await sequelize.query(`
      UPDATE inventory_items SET
        name = :name, category = :category, 
        unit = :unit, reorder_level = :reorder_level, 
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
      RETURNING *
    `, { replacements: { id, schoolId, name, category, unit, reorder_level } });

    if (result.length === 0) return res.fail('Item not found', [], 404);

    res.ok(result[0], 'Item updated.');
  } catch (err) { next(err); }
};

exports.deleteItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    
    const [result] = await sequelize.query(`
      DELETE FROM inventory_items WHERE id = :id AND school_id = :schoolId RETURNING id
    `, { replacements: { id, schoolId } });

    if (result.length === 0) return res.fail('Item not found', [], 404);

    res.ok(null, 'Item deleted.');
  } catch (err) { next(err); }
};

exports.getTransactions = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { item_id } = req.query;

    let itemFilter = '';
    const replacements = { schoolId };
    if (item_id) {
      itemFilter = 'AND t.item_id = :item_id';
      replacements.item_id = item_id;
    }

    const [transactions] = await sequelize.query(`
      SELECT t.*, i.name AS item_name, i.unit, u.name AS performed_by_name
      FROM inventory_transactions t
      JOIN inventory_items i ON i.id = t.item_id
      LEFT JOIN users u ON u.id = t.performed_by
      WHERE i.school_id = :schoolId ${itemFilter}
      ORDER BY t.date DESC, t.id DESC;
    `, { replacements });

    res.ok(transactions);
  } catch (err) { next(err); }
};

exports.recordTransaction = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { item_id, type, quantity, date, remarks } = req.body;

    const [[item]] = await sequelize.query(`
      SELECT * FROM inventory_items WHERE id = :item_id AND school_id = :schoolId
    `, { replacements: { item_id, schoolId } });

    if (!item) return res.fail('Item not found.', [], 404);

    const qty = parseFloat(quantity);
    if (type === 'out' && parseFloat(item.quantity) < qty) {
      return res.fail('Insufficient stock.', [], 400);
    }

    const [tRecord] = await sequelize.query(`
      INSERT INTO inventory_transactions (
        item_id, type, quantity, date, remarks, performed_by, created_at, updated_at
      ) VALUES (
        :item_id, :type, :qty, :date, :remarks, :performed_by, NOW(), NOW()
      ) RETURNING *
    `, { replacements: { 
      item_id, type, qty, 
      date: date || new Date().toISOString().split('T')[0], 
      remarks, 
      performed_by: req.user.id 
    } });

    const newQty = type === 'in' ? parseFloat(item.quantity) + qty : parseFloat(item.quantity) - qty;
    
    await sequelize.query(`
      UPDATE inventory_items SET quantity = :newQty, updated_at = NOW() WHERE id = :item_id
    `, { replacements: { newQty, item_id } });

    res.ok(tRecord[0], 'Transaction recorded.', 201);
  } catch (err) { next(err); }
};
