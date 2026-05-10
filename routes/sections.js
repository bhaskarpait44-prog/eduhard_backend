'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/classController');
const { requireAdminOrTeacher } = require('../middlewares/auth');

router.get('/', requireAdminOrTeacher, ctrl.getSections);

module.exports = router;
