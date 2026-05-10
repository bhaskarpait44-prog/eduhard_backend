'use strict';

const sequelize = require('../config/database');
const { InventoryItem, InventoryTransaction } = require('../models');

exports.getItems = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const items = await InventoryItem.findAll({ where: { school_id: schoolId }, order: [['name', 'ASC']] });
    res.ok(items);
  } catch (err) { next(err); }
};

exports.createItem = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { name, category, unit, reorder_level } = req.body;
    const item = await InventoryItem.create({ school_id: schoolId, name, category, unit, reorder_level: reorder_level || 0, quantity: 0 });
    res.ok(item, 'Item created.', 201);
  } catch (err) { next(err); }
};

exports.updateItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { name, category, unit, reorder_level } = req.body;
    
    const item = await InventoryItem.findOne({ where: { id, school_id: schoolId } });
    if (!item) return res.fail('Item not found', [], 404);

    await item.update({ name, category, unit, reorder_level });
    res.ok(item, 'Item updated.');
  } catch (err) { next(err); }
};

exports.deleteItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    await InventoryItem.destroy({ where: { id, school_id: schoolId } });
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
  const transaction = await sequelize.transaction();
  try {
    const schoolId = req.user.school_id;
    const { item_id, type, quantity, date, remarks } = req.body;

    const item = await InventoryItem.findOne({ where: { id: item_id, school_id: schoolId }, transaction });
    if (!item) {
      await transaction.rollback();
      return res.fail('Item not found.', [], 404);
    }

    const qty = parseFloat(quantity);
    if (type === 'out' && parseFloat(item.quantity) < qty) {
      await transaction.rollback();
      return res.fail('Insufficient stock.', [], 400);
    }

    const tRecord = await InventoryTransaction.create({
      item_id, type, quantity: qty, date, remarks, performed_by: req.user.id
    }, { transaction });

    const newQty = type === 'in' ? parseFloat(item.quantity) + qty : parseFloat(item.quantity) - qty;
    await item.update({ quantity: newQty }, { transaction });

    await transaction.commit();
    res.ok(tRecord, 'Transaction recorded.', 201);
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
};
