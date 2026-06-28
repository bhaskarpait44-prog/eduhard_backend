'use strict';

/**
 * libraryScheduler.js
 * Automated cron jobs for the Library module.
 * - Nightly at 01:00: Mark overdue books (all schools)
 * - Hourly at :05: Expire stale reservations and promote next in queue
 */

const cron = require('node-cron');
const sequelize = require('../config/database');
const logger = require('./logger');

/**
 * Mark all issued books with past due_date as 'overdue' across all schools.
 * Runs nightly at 01:00.
 */
const markOverdueBooks = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [result] = await sequelize.query(`
      UPDATE library_issues
      SET status = 'overdue', updated_at = NOW()
      WHERE status = 'issued' AND due_date < :today
      RETURNING id
    `, { replacements: { today } });
    if (result.length > 0) {
      logger.info(`[LibraryScheduler] Marked ${result.length} issue(s) as overdue.`);
    }
  } catch (err) {
    logger.error('[LibraryScheduler] Error marking overdue books: ' + err.message);
  }
};

/**
 * Expire 'ready' reservations that have passed their expires_at timestamp.
 * Restore available_copies for the book and promote the next 'pending' reservation.
 * Runs hourly at :05.
 */
const expireStaleReservations = async () => {
  const t = await sequelize.transaction();
  try {
    // Find all stale 'ready' reservations
    const [staleReservations] = await sequelize.query(`
      UPDATE library_reservations
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'ready' AND expires_at < NOW()
      RETURNING id, book_id, school_id
    `, { transaction: t });

    if (staleReservations.length === 0) {
      await t.commit();
      return;
    }

    logger.info(`[LibraryScheduler] Expiring ${staleReservations.length} stale reservation(s).`);

    for (const expired of staleReservations) {
      // Restore the available copy that was held
      await sequelize.query(`
        UPDATE library_books SET available_copies = available_copies + 1, updated_at = NOW()
        WHERE id = :bookId
      `, { replacements: { bookId: expired.book_id }, transaction: t });

      // Promote the next pending reservation for this book, if any
      const [[nextReservation]] = await sequelize.query(`
        SELECT id FROM library_reservations
        WHERE book_id = :bookId AND school_id = :schoolId AND status = 'pending'
        ORDER BY reservation_date ASC
        LIMIT 1
      `, { replacements: { bookId: expired.book_id, schoolId: expired.school_id }, transaction: t });

      if (nextReservation) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 2);

        await sequelize.query(`
          UPDATE library_reservations
          SET status = 'ready', expires_at = :expiresAt, updated_at = NOW()
          WHERE id = :reservationId
        `, { replacements: { reservationId: nextReservation.id, expiresAt }, transaction: t });

        // Decrement again — book is now held for the next person
        await sequelize.query(`
          UPDATE library_books SET available_copies = available_copies - 1, updated_at = NOW()
          WHERE id = :bookId
        `, { replacements: { bookId: expired.book_id }, transaction: t });

        logger.info(`[LibraryScheduler] Promoted reservation ${nextReservation.id} to ready for book ${expired.book_id}.`);
      }
    }

    await t.commit();
  } catch (err) {
    await t.rollback();
    logger.error('[LibraryScheduler] Error expiring stale reservations: ' + err.message);
  }
};

// Schedule: nightly at 01:00 — mark overdue books
cron.schedule('0 1 * * *', () => {
  logger.info('[LibraryScheduler] Running nightly overdue check...');
  markOverdueBooks();
});

// Schedule: hourly at :05 — expire stale reservations
cron.schedule('5 * * * *', () => {
  expireStaleReservations();
});

logger.info('[LibraryScheduler] Library scheduler initialized.');

module.exports = { markOverdueBooks, expireStaleReservations };
