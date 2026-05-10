'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middlewares/validate');
const ctrl = require('../controllers/accountantController');
const { requirePermission } = require('../middlewares/checkPermission');
const accountantValidators = require('../validators/accountantValidators');

router.get('/dashboard', requirePermission('fees.view'), ctrl.getDashboard);
router.get('/dashboard/today-stats', requirePermission('fees.view'), ctrl.getTodayStats);
router.get('/dashboard/recent-transactions', requirePermission('fees.view'), ctrl.getRecentTransactions);
router.get('/dashboard/pending-tasks', requirePermission('fees.view'), ctrl.getPendingTasks);
router.get('/dashboard/week-trend', requirePermission('fees.view'), ctrl.getWeekTrend);

router.get('/students/search', requirePermission('fees.collect'), ctrl.searchStudents);
router.get('/students', requirePermission('fees.view'), ctrl.getStudents);
router.get('/students/:id/pending-invoices', requirePermission('fees.collect'), ctrl.getStudentPendingInvoices);
router.get('/students/:id/fees', requirePermission('fees.view'), ctrl.getStudentFees);
router.get('/students/:id/invoices', requirePermission('fees.view'), ctrl.getStudentInvoices);
router.get('/students/:id/payments', requirePermission('fees.view'), ctrl.getStudentPayments);
router.get('/students/:id/statement/pdf', requirePermission('fees.view'), ctrl.getStudentStatementPdf);

router.post('/collect',
  requirePermission('fees.collect'),
  accountantValidators.collectFeesRules,
  validate,
  ctrl.collectFees
);

router.get('/receipt/:id', requirePermission('fees.view'), ctrl.getReceipt);
router.get('/receipt/:id/pdf', requirePermission('fees.view'), ctrl.getReceiptPdf);

router.get('/fee-structure', requirePermission('fees.view'), ctrl.getFeeStructure);
router.post('/fee-structure', 
  requirePermission('fees.edit'), 
  accountantValidators.feeStructureRules, 
  validate, 
  ctrl.createFeeStructure
);
router.patch('/fee-structure/:id', requirePermission('fees.edit'), ctrl.updateFeeStructure);
router.delete('/fee-structure/:id', requirePermission('fees.edit'), ctrl.deleteFeeStructure);
router.post('/fee-structure/generate-invoices', requirePermission('fees.edit'), ctrl.generateFeeInvoices);
router.post('/fee-structure/copy-from-session', requirePermission('fees.edit'), ctrl.copyFeeStructureFromSession);

router.get('/invoices', requirePermission('fees.view'), ctrl.getInvoices);
router.get('/invoices/overdue', requirePermission('fees.view'), ctrl.getOverdueInvoices);
router.get('/invoices/due-today', requirePermission('fees.view'), ctrl.getDueTodayInvoices);

router.get('/receipts', requirePermission('fees.view'), ctrl.getReceipts);
router.get('/receipts/:id', requirePermission('fees.view'), ctrl.getReceiptById);
router.get('/receipts/:id/pdf', requirePermission('fees.view'), ctrl.getReceiptPdfById);
router.post('/receipts/:id/duplicate', requirePermission('fees.view'), ctrl.duplicateReceipt);
router.post('/receipts/:id/email', requirePermission('fees.view'), ctrl.emailReceipt);
router.post('/receipts/:id/whatsapp', requirePermission('fees.view'), ctrl.whatsappReceipt);

router.get('/defaulters', requirePermission('fees.view'), ctrl.getDefaulters);
router.post('/defaulters/remind', requirePermission('fees.collect'), ctrl.sendDefaulterReminder);
router.post('/defaulters/remind-bulk', requirePermission('fees.collect'), ctrl.sendBulkDefaulterReminder);

router.get('/notices', requirePermission('fees.view'), ctrl.getNotices);
router.post('/notices', 
  requirePermission('fees.collect'), 
  accountantValidators.createNoticeRules, 
  validate, 
  ctrl.createNotice
);

router.get('/concessions', requirePermission('fees.waive'), ctrl.getConcessions);
router.post('/concessions/apply', 
  requirePermission('fees.waive'), 
  accountantValidators.applyConcessionRules, 
  validate, 
  ctrl.applyConcession
);
router.get('/concessions/report', requirePermission('fees.waive'), ctrl.getConcessionReport);

router.get('/reports/daily', requirePermission('fees.report'), ctrl.getDailyReport);
router.get('/reports/monthly', requirePermission('fees.report'), ctrl.getMonthlyReport);
router.get('/reports/classwise', requirePermission('fees.report'), ctrl.getClasswiseReport);
router.get('/reports/session', requirePermission('fees.report'), ctrl.getSessionReport);
router.get('/reports/defaulters', requirePermission('fees.report'), ctrl.getDefaulterReport);
router.get('/reports/concessions', requirePermission('fees.report'), ctrl.getConcessionsReport);
router.post('/reports/custom', requirePermission('reports.export'), ctrl.buildCustomReport);

router.get('/carry-forward/eligible', requirePermission('fees.collect'), ctrl.getCarryForwardEligible);
router.post('/carry-forward/single', requirePermission('fees.collect'), ctrl.carryForwardSingle);
router.post('/carry-forward/bulk', requirePermission('fees.collect'), ctrl.carryForwardBulk);

router.get('/refunds', requirePermission('fees.refund'), ctrl.getRefunds);
router.post('/refunds/process', requirePermission('fees.refund'), ctrl.processRefund);
router.get('/refunds/report', requirePermission('fees.refund'), ctrl.getRefundReport);

router.get('/cheques', requirePermission('fees.collect'), ctrl.getCheques);
router.get('/cheques/pending', requirePermission('fees.collect'), ctrl.getPendingCheques);
router.post('/cheques/:id/clear', requirePermission('fees.collect'), ctrl.clearCheque);
router.post('/cheques/:id/bounce', requirePermission('fees.collect'), ctrl.bounceCheque);

router.get('/profile', requirePermission('fees.view'), ctrl.getProfile);
router.get('/profile/activity', requirePermission('fees.view'), ctrl.getProfileActivity);
router.post('/profile/change-password', requirePermission('fees.view'), ctrl.changePassword);

module.exports = router;
