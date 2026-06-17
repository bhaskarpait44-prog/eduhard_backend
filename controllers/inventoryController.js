'use strict';
const sequelize = require('../config/database');

// ─── ITEMS ───────────────────────────────────────────────

exports.getItems = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { category, search } = req.query;
    let filters = 'WHERE school_id = :schoolId';
    const replacements = { schoolId };
    if (category) { filters += ' AND category = :category'; replacements.category = category; }
    if (search)   { filters += ' AND (LOWER(name) LIKE :search OR LOWER(category) LIKE :search)'; replacements.search = `%${search.toLowerCase()}%`; }

    const [items] = await sequelize.query(
      `SELECT * FROM inventory_items ${filters} ORDER BY name ASC`,
      { replacements }
    );
    res.ok(items);
  } catch (err) { next(err); }
};

exports.getCategories = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const [rows] = await sequelize.query(
      `SELECT DISTINCT category FROM inventory_items WHERE school_id = :schoolId ORDER BY category ASC`,
      { replacements: { schoolId } }
    );
    res.ok(rows.map(r => r.category));
  } catch (err) { next(err); }
};

exports.createItem = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { name, category, unit, reorder_level, description, location, unit_price } = req.body;

    // Validation
    if (!name?.trim())     return res.fail('Item name is required.', [], 422);
    if (!category?.trim()) return res.fail('Category is required (e.g. Stationery, Lab).', [], 422);
    if (!unit?.trim())     return res.fail('Unit is required (e.g. Pcs, Box, Rim, Kg).', [], 422);
    const rl = parseFloat(reorder_level);
    if (isNaN(rl) || rl < 0) return res.fail('Reorder level must be zero or a positive number.', [], 422);
    if (unit_price !== undefined && unit_price !== '' && (isNaN(parseFloat(unit_price)) || parseFloat(unit_price) < 0))
      return res.fail('Unit price must be a positive number.', [], 422);

    // Duplicate check
    const [[existing]] = await sequelize.query(
      `SELECT id FROM inventory_items WHERE school_id = :schoolId AND LOWER(name) = LOWER(:name) LIMIT 1`,
      { replacements: { schoolId, name: name.trim() } }
    );
    if (existing) return res.fail(`An item named "${name.trim()}" already exists in your catalog.`, [], 409);

    const [item] = await sequelize.query(`
      INSERT INTO inventory_items
        (school_id, name, category, unit, reorder_level, quantity, description, location, unit_price, created_at, updated_at)
      VALUES
        (:schoolId, :name, :category, :unit, :reorder_level, 0, :description, :location, :unit_price, NOW(), NOW())
      RETURNING *
    `, { replacements: {
      schoolId,
      name: name.trim(), category: category.trim(), unit: unit.trim(),
      reorder_level: rl,
      description: description?.trim() || null,
      location: location?.trim() || null,
      unit_price: unit_price ? parseFloat(unit_price) : null,
    }});

    res.ok(item[0], 'Item added to catalog.', 201);
  } catch (err) { next(err); }
};

exports.updateItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { name, category, unit, reorder_level, description, location, unit_price } = req.body;

    if (!name?.trim())     return res.fail('Item name is required.', [], 422);
    if (!category?.trim()) return res.fail('Category is required.', [], 422);
    if (!unit?.trim())     return res.fail('Unit is required.', [], 422);
    const rl = parseFloat(reorder_level);
    if (isNaN(rl) || rl < 0) return res.fail('Reorder level must be zero or a positive number.', [], 422);

    // Duplicate name check (exclude self)
    const [[dup]] = await sequelize.query(
      `SELECT id FROM inventory_items WHERE school_id = :schoolId AND LOWER(name) = LOWER(:name) AND id != :id LIMIT 1`,
      { replacements: { schoolId, name: name.trim(), id } }
    );
    if (dup) return res.fail(`Another item named "${name.trim()}" already exists.`, [], 409);

    const [result] = await sequelize.query(`
      UPDATE inventory_items SET
        name = :name, category = :category, unit = :unit,
        reorder_level = :reorder_level, description = :description,
        location = :location, unit_price = :unit_price, updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId RETURNING *
    `, { replacements: {
      id, schoolId,
      name: name.trim(), category: category.trim(), unit: unit.trim(),
      reorder_level: rl,
      description: description?.trim() || null,
      location: location?.trim() || null,
      unit_price: unit_price ? parseFloat(unit_price) : null,
    }});

    if (result.length === 0) return res.fail('Item not found.', [], 404);
    res.ok(result[0], 'Item updated.');
  } catch (err) { next(err); }
};

exports.deleteItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    // Prevent deletion if transactions exist
    const [[txCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM inventory_transactions WHERE item_id = :id`,
      { replacements: { id } }
    );
    if (parseInt(txCheck.cnt) > 0)
      return res.fail(
        'This item has transaction history and cannot be deleted. Set the reorder level to 0 to hide it from alerts.',
        [], 409
      );

    const [result] = await sequelize.query(
      `DELETE FROM inventory_items WHERE id = :id AND school_id = :schoolId RETURNING id`,
      { replacements: { id, schoolId } }
    );
    if (result.length === 0) return res.fail('Item not found.', [], 404);
    res.ok(null, 'Item deleted.');
  } catch (err) { next(err); }
};

// ─── TRANSACTIONS ─────────────────────────────────────────

exports.getTransactions = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { item_id, type, date_from, date_to, page = 1, limit = 50 } = req.query;

    let conditions = ['i.school_id = :schoolId'];
    const replacements = { schoolId };

    if (item_id)  { conditions.push('t.item_id = :item_id');        replacements.item_id   = item_id; }
    if (type)     { conditions.push('t.type = :type');              replacements.type      = type; }
    if (date_from){ conditions.push('t.date >= :date_from');        replacements.date_from = date_from; }
    if (date_to)  { conditions.push('t.date <= :date_to');          replacements.date_to   = date_to; }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const WHERE = 'WHERE ' + conditions.join(' AND ');

    const [[{ total }]] = await sequelize.query(
      `SELECT COUNT(*) AS total FROM inventory_transactions t
       JOIN inventory_items i ON i.id = t.item_id ${WHERE}`,
      { replacements }
    );

    const [transactions] = await sequelize.query(`
      SELECT t.*, i.name AS item_name, i.unit, i.category,
             u.name AS performed_by_name
      FROM inventory_transactions t
      JOIN inventory_items i ON i.id = t.item_id
      LEFT JOIN users u ON u.id = t.performed_by
      ${WHERE}
      ORDER BY t.date DESC, t.id DESC
      LIMIT :limit OFFSET :offset
    `, { replacements: { ...replacements, limit: parseInt(limit), offset } });

    res.ok({ transactions, total: parseInt(total), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
};

exports.recordTransaction = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { item_id, type, quantity, date, remarks, vendor } = req.body;

    // Validation
    if (!item_id)                        return res.fail('Please select an item.', [], 422);
    if (!['in', 'out'].includes(type))   return res.fail("Type must be 'in' or 'out'.", [], 422);
    if (!date || isNaN(Date.parse(date))) return res.fail('Please provide a valid date.', [], 422);
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0)          return res.fail('Quantity must be a positive number greater than zero.', [], 422);

    const result = await sequelize.transaction(async (t) => {
      const [[item]] = await sequelize.query(
        `SELECT * FROM inventory_items WHERE id = :item_id AND school_id = :schoolId FOR UPDATE`,
        { replacements: { item_id, schoolId }, transaction: t }
      );
      if (!item) throw Object.assign(new Error('Item not found.'), { status: 404 });

      const currentQty = parseFloat(item.quantity);
      if (type === 'out' && currentQty < qty)
        throw Object.assign(
          new Error(`Insufficient stock. Available: ${currentQty} ${item.unit}, requested: ${qty} ${item.unit}.`),
          { status: 400 }
        );

      const [tRecord] = await sequelize.query(`
        INSERT INTO inventory_transactions
          (item_id, type, quantity, date, remarks, vendor, performed_by, created_at, updated_at)
        VALUES
          (:item_id, :type, :qty, :date, :remarks, :vendor, :performed_by, NOW(), NOW())
        RETURNING *
      `, { replacements: {
        item_id, type, qty, date,
        remarks: remarks?.trim() || null,
        vendor: vendor?.trim() || null,
        performed_by: req.user.id
      }, transaction: t });

      const newQty = type === 'in' ? currentQty + qty : currentQty - qty;
      await sequelize.query(
        `UPDATE inventory_items SET quantity = :newQty, updated_at = NOW() WHERE id = :item_id`,
        { replacements: { newQty, item_id }, transaction: t }
      );

      return tRecord[0];
    });

    res.ok(result, 'Transaction recorded.', 201);
  } catch (err) {
    if (err.status) return res.fail(err.message, [], err.status);
    next(err);
  }
};

// ─── PDF DATA ENDPOINTS ───────────────────────────────────

exports.getItemCatalogData = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const [items] = await sequelize.query(
      `SELECT *, (quantity <= reorder_level AND reorder_level > 0) AS is_low_stock
       FROM inventory_items WHERE school_id = :schoolId ORDER BY category ASC, name ASC`,
      { replacements: { schoolId } }
    );
    const [[school]] = await sequelize.query(
      `SELECT name, address, phone, email, logo_url FROM schools WHERE id = :schoolId`,
      { replacements: { schoolId } }
    );
    res.ok({ school, items, generated_by: req.user.name, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
};

exports.getStockInData = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { date_from, date_to } = req.query;
    const replacements = { schoolId };
    let dateFilter = '';
    if (date_from) { dateFilter += ' AND t.date >= :date_from'; replacements.date_from = date_from; }
    if (date_to)   { dateFilter += ' AND t.date <= :date_to';   replacements.date_to   = date_to; }

    const [transactions] = await sequelize.query(`
      SELECT t.*, i.name AS item_name, i.unit, i.category,
             u.name AS performed_by_name
      FROM inventory_transactions t
      JOIN inventory_items i ON i.id = t.item_id
      LEFT JOIN users u ON u.id = t.performed_by
      WHERE i.school_id = :schoolId AND t.type = 'in' ${dateFilter}
      ORDER BY t.date ASC, i.name ASC
    `, { replacements });

    const [[school]] = await sequelize.query(
      `SELECT name, address, phone, email, logo_url FROM schools WHERE id = :schoolId`,
      { replacements: { schoolId } }
    );

    res.ok({
      school, transactions,
      date_from: date_from || null, date_to: date_to || null,
      generated_by: req.user.name, generated_at: new Date().toISOString()
    });
  } catch (err) { next(err); }
};

exports.getStockOutData = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { date_from, date_to } = req.query;
    const replacements = { schoolId };
    let dateFilter = '';
    if (date_from) { dateFilter += ' AND t.date >= :date_from'; replacements.date_from = date_from; }
    if (date_to)   { dateFilter += ' AND t.date <= :date_to';   replacements.date_to   = date_to; }

    const [transactions] = await sequelize.query(`
      SELECT t.*, i.name AS item_name, i.unit, i.category,
             u.name AS performed_by_name, i.quantity AS current_quantity, i.reorder_level
      FROM inventory_transactions t
      JOIN inventory_items i ON i.id = t.item_id
      LEFT JOIN users u ON u.id = t.performed_by
      WHERE i.school_id = :schoolId AND t.type = 'out' ${dateFilter}
      ORDER BY t.date ASC, i.name ASC
    `, { replacements });

    const [[school]] = await sequelize.query(
      `SELECT name, address, phone, email, logo_url FROM schools WHERE id = :schoolId`,
      { replacements: { schoolId } }
    );

    // Items currently below reorder level
    const [lowStockItems] = await sequelize.query(`
      SELECT name, unit, quantity, reorder_level FROM inventory_items
      WHERE school_id = :schoolId AND reorder_level > 0 AND quantity <= reorder_level
      ORDER BY name ASC
    `, { replacements: { schoolId } });

    res.ok({
      school, transactions, low_stock_items: lowStockItems,
      date_from: date_from || null, date_to: date_to || null,
      generated_by: req.user.name, generated_at: new Date().toISOString()
    });
  } catch (err) { next(err); }
};

exports.getLowStockData = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const [items] = await sequelize.query(
      `SELECT *, (reorder_level - quantity) AS shortfall
       FROM inventory_items 
       WHERE school_id = :schoolId AND reorder_level > 0 AND quantity <= reorder_level
       ORDER BY category ASC, name ASC`,
      { replacements: { schoolId } }
    );
    const [[school]] = await sequelize.query(
      `SELECT name, address, phone, email, logo_url FROM schools WHERE id = :schoolId`,
      { replacements: { schoolId } }
    );
    res.ok({ school, items, generated_by: req.user.name, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
};
