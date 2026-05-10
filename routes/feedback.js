'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/feedbackController');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', ctrl.submit);
router.patch('/:id/reply', requireRole(['admin']), ctrl.reply);
router.delete('/:id', ctrl.delete);

module.exports = router;
