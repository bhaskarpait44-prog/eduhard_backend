'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/academicCalendarController');
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/checkPermission');
const { cache } = require('../middlewares/cache');

router.use(authenticate);

router.get('/', requirePermission('calendar.view'), cache(300), ctrl.list);
router.get('/download', requirePermission('calendar.view'), ctrl.downloadPdf);
router.post('/', requirePermission('calendar.create'), ctrl.create);
router.patch('/:id', requirePermission('calendar.edit'), ctrl.update);
router.delete('/:id', requirePermission('calendar.edit'), ctrl.destroy);
router.patch('/:id/publish', requirePermission('calendar.edit'), ctrl.togglePublish);

module.exports = router;
