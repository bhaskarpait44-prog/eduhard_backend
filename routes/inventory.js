'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/inventoryController');
const { requireRole } = require('../middlewares/auth');

router.use(requireRole('admin', 'accountant'));

// Items
router.get('/items', ctrl.getItems);
router.get('/items/categories', ctrl.getCategories);
router.post('/items', ctrl.createItem);
router.patch('/items/:id', ctrl.updateItem);
router.delete('/items/:id', ctrl.deleteItem);

// Transactions
router.get('/transactions', ctrl.getTransactions);
router.post('/transactions', ctrl.recordTransaction);

// PDF data
router.get('/pdf/catalog', ctrl.getItemCatalogData);
router.get('/pdf/stock-in', ctrl.getStockInData);
router.get('/pdf/stock-out', ctrl.getStockOutData);
router.get('/pdf/low-stock', ctrl.getLowStockData);

module.exports = router;
