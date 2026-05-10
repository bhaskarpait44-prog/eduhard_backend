'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/inventoryController');
const { requireRole } = require('../middlewares/auth');

router.use(requireRole('admin', 'accountant'));

router.get('/items', ctrl.getItems);
router.post('/items', ctrl.createItem);
router.patch('/items/:id', ctrl.updateItem);
router.delete('/items/:id', ctrl.deleteItem);

router.get('/transactions', ctrl.getTransactions);
router.post('/transactions', ctrl.recordTransaction);

module.exports = router;
