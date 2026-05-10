'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/healthController');
const { requireRole } = require('../middlewares/auth');

router.use(requireRole(['admin', 'teacher']));

router.get('/:student_id', ctrl.getHealthProfile);
router.patch('/:student_id', ctrl.updateHealthProfile);

router.post('/:student_id/vaccinations', ctrl.addVaccination);
router.delete('/vaccinations/:id', ctrl.deleteVaccination);

router.post('/:student_id/incidents', ctrl.addIncident);
router.delete('/incidents/:id', ctrl.deleteIncident);

module.exports = router;
