'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/familyController');
const { requireRole } = require('../middlewares/auth');

router.use(requireRole('admin', 'accountant'));

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.get('/student/:student_id', ctrl.getStudentFamily);

module.exports = router;
