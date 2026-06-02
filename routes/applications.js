'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/publicController');

router.post('/', ctrl.createApplication);

module.exports = router;
