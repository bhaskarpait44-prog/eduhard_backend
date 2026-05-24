const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { requirePermission } = require('../middlewares/checkPermission');
const ctrl = require('../controllers/certificateController');

// All certificate routes require authentication
router.get('/', authenticate, requirePermission('certificates.view'), ctrl.getCertificates);
router.post('/generate', authenticate, requirePermission('certificates.create'), ctrl.generateCertificate);
router.get('/:id', authenticate, requirePermission('certificates.view'), ctrl.getCertificateById);
router.patch('/:id/revoke', authenticate, requirePermission('certificates.revoke'), ctrl.revokeCertificate);

module.exports = router;
