'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middlewares/auth');

const bookController = require('../controllers/libraryBookController');
const issueController = require('../controllers/libraryIssueController');
const fineController = require('../controllers/libraryFineController');
const reservationController = require('../controllers/libraryReservationController');
const dashboardController = require('../controllers/libraryDashboardController');
const settingsController = require('../controllers/librarySettingsController');

// All library routes require authentication
router.use(authenticate);

// Dashboard
router.get('/dashboard', requireRole('admin', 'librarian'), dashboardController.getDashboardStats);

// Settings
router.get('/settings', requireRole('admin', 'librarian'), settingsController.getSettings);
router.put('/settings', requireRole('admin', 'librarian'), settingsController.updateSettings);

// Books
router.get('/books', bookController.getBooks);
router.get('/books/:id', bookController.getBook);
router.post('/books', requireRole('admin', 'librarian'), bookController.createBook);
router.post('/books/import/preview', requireRole('admin', 'librarian'), bookController.previewImportBooks);
router.post('/books/import/confirm', requireRole('admin', 'librarian'), bookController.confirmImportBooks);
router.put('/books/:id', requireRole('admin', 'librarian'), bookController.updateBook);
router.delete('/books/:id', requireRole('admin', 'librarian'), bookController.deleteBook);

// Issues
router.get('/issues', requireRole('admin', 'librarian'), issueController.getIssues);
router.get('/issues/my', issueController.getMyIssues);
router.post('/issues', requireRole('admin', 'librarian'), issueController.issueBook);
router.patch('/issues/mark-overdue', requireRole('admin', 'librarian'), issueController.markOverdue);
router.patch('/issues/:id/return', requireRole('admin', 'librarian'), issueController.returnBook);

// Reservations
router.get('/reservations', requireRole('admin', 'librarian'), reservationController.getReservations);
router.get('/reservations/my', reservationController.getMyReservations);
router.post('/reservations', reservationController.createReservation);
router.patch('/reservations/:id/cancel', reservationController.cancelReservation);

// Fines
router.get('/fines', requireRole('admin', 'librarian', 'accountant'), fineController.getFines);
router.get('/fines/summary', requireRole('admin', 'librarian', 'accountant'), fineController.getFineSummary);
router.patch('/fines/:id', requireRole('admin', 'librarian'), fineController.updateFineStatus);

module.exports = router;
