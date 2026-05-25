'use strict';

/**
 * utils/feeManager.js
 *
 * Three core fee functions.
 * All monetary values handled as floats internally but stored as DECIMAL(10,2).
 * Always parseFloat() when reading from DB to avoid string arithmetic bugs.
 */

const { Op }       = require('sequelize');
const sequelize    = require('../config/database');
const FeeStructure = require('../models/FeeStructure');
const FeeInvoice   = require('../models/FeeInvoice');
const FeePayment   = require('../models/FeePayment');

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a session and a fee structure's frequency, returns an array of
 * { due_date } objects representing each billing period in the session.
 *
 * @param {string} sessionStart  'YYYY-MM-DD'
 * @param {string} sessionEnd    'YYYY-MM-DD'
 * @param {'monthly'|'quarterly'|'annual'|'one_time'} frequency
 * @param {number} dueDay        day of month (1–28)
 * @returns {Array<{ due_date: string }>}
 */
function buildDueDates(sessionStart, sessionEnd, frequency, dueDay) {
  const start  = new Date(sessionStart + 'T00:00:00Z');
  const end    = new Date(sessionEnd   + 'T00:00:00Z');
  const dates  = [];

  const makeDate = (year, month, day) => {
    // month is 0-indexed here
    const d = new Date(Date.UTC(year, month, Math.min(day, 28)));
    return d.toISOString().split('T')[0];
  };

  if (frequency === 'one_time' || frequency === 'annual') {
    // Due at the start of the session
    dates.push({ due_date: makeDate(start.getUTCFullYear(), start.getUTCMonth(), dueDay) });
    return dates;
  }

  const stepMonths = frequency === 'monthly' ? 1 : 3; // quarterly = every 3 months

  let cursor = new Date(start);
  while (cursor <= end) {
    dates.push({
      due_date: makeDate(cursor.getUTCFullYear(), cursor.getUTCMonth(), dueDay),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + stepMonths);
  }

  return dates;
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 1: generateInvoices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates invoice records for all active enrollments in a session.
 *
 * Algorithm:
 *   For each active enrollment in the session:
 *     For each active fee_structure matching that enrollment's class:
 *       Generate one invoice per billing period (based on frequency)
 *       Skip if invoice already exists (idempotent — safe to re-run)
 *
 * @param {number} sessionId
 * @returns {{
 *   sessionId      : number,
 *   totalEnrollments : number,
 *   totalStructures  : number,
 *   invoicesCreated  : number,
 *   invoicesSkipped  : number,
 *   breakdown        : Array
 * }}
 */
async function generateInvoices(sessionId) {
  // ── Fetch session date range ─────────────────────────────────────────────
  const [[session]] = await sequelize.query(`
    SELECT id, name, start_date, end_date
    FROM sessions
    WHERE id = :sessionId;
  `, { replacements: { sessionId } });

  if (!session) throw new Error(`Session id=${sessionId} not found.`);

  // ── Fetch all active enrollments for this session ────────────────────────
  const [enrollments] = await sequelize.query(`
    SELECT e.id AS enrollment_id, e.class_id, e.student_id,
           (SELECT COUNT(id) FROM students WHERE family_id = s.family_id AND is_deleted = false AND is_active = true) AS sibling_count
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    WHERE e.session_id = :sessionId
      AND e.status     = 'active';
  `, { replacements: { sessionId } });

  // ── Fetch all active fee structures for this session ─────────────────────
  const [structures] = await sequelize.query(`
    SELECT id, class_id, name, amount, frequency, due_day
    FROM fee_structures
    WHERE session_id = :sessionId
      AND is_active  = true;
  `, { replacements: { sessionId } });

  // Group structures by class_id for fast lookup
  const structuresByClass = {};
  structures.forEach(s => {
    if (!structuresByClass[s.class_id]) structuresByClass[s.class_id] = [];
    structuresByClass[s.class_id].push(s);
  });

  let invoicesCreated = 0;
  let invoicesSkipped = 0;
  const breakdown     = [];

  // ── Process each enrollment ──────────────────────────────────────────────
  await sequelize.transaction(async (t) => {
    for (const enrollment of enrollments) {
      const classStructures = structuresByClass[enrollment.class_id] || [];
      const enrollmentSummary = { enrollmentId: enrollment.enrollment_id, invoices: [] };

      // Apply a simple 10% discount on Tuition fees if they have 2 or more active students in the family
      const hasSiblingDiscount = enrollment.sibling_count > 1;

      for (const structure of classStructures) {
        const dueDates = buildDueDates(
          session.start_date,
          session.end_date,
          structure.frequency,
          structure.due_day
        );

        for (const { due_date } of dueDates) {
          // Check if invoice already exists (idempotent)
          const [existing] = await sequelize.query(`
            SELECT id FROM fee_invoices
            WHERE enrollment_id    = :enrollmentId
              AND fee_structure_id = :feeStructureId
              AND due_date         = :dueDate
            LIMIT 1;
          `, {
            replacements: {
              enrollmentId   : enrollment.enrollment_id,
              feeStructureId : structure.id,
              dueDate        : due_date,
            },
            transaction: t,
          });

          if (existing.length > 0) {
            invoicesSkipped++;
            continue;
          }

          let concessionAmount = 0;
          let concessionReason = null;

          if (hasSiblingDiscount && structure.name.toLowerCase().includes('tuition')) {
            concessionAmount = parseFloat(structure.amount) * 0.10; // 10% discount
            concessionReason = 'Auto Sibling Discount';
          }

          const amountDue = parseFloat(structure.amount) - concessionAmount;

          await sequelize.getQueryInterface().bulkInsert('fee_invoices', [{
            enrollment_id    : enrollment.enrollment_id,
            fee_structure_id : structure.id,
            amount_due       : amountDue.toFixed(2),
            amount_paid      : '0.00',
            due_date,
            paid_date        : null,
            status           : 'pending',
            carry_from_invoice_id : null,
            late_fee_amount  : '0.00',
            concession_amount: concessionAmount.toFixed(2),
            concession_reason: concessionReason,
            created_at       : new Date(),
            updated_at       : new Date(),
          }], { transaction: t });

          invoicesCreated++;
          enrollmentSummary.invoices.push({ fee: structure.name, due_date, amount: structure.amount });
        }
      }

      if (enrollmentSummary.invoices.length > 0) breakdown.push(enrollmentSummary);
    }
  });

  return {
    sessionId,
    sessionName      : session.name,
    totalEnrollments : enrollments.length,
    totalStructures  : structures.length,
    invoicesCreated,
    invoicesSkipped,
    breakdown,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 2: carryForwardFees
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carries unpaid invoices from an old session into the new session.
 *
 * Steps:
 *   1. Find the student's enrollment in the old session
 *   2. Find all pending/partial invoices in that enrollment
 *   3. Find the student's enrollment in the new session
 *   4. For each unpaid invoice, create a new invoice in the new session
 *      with carry_from_invoice_id pointing to the original
 *   5. Mark original invoices as 'carried_forward'
 *   6. Old invoices are NEVER deleted or modified beyond status
 *
 * @param {number} studentId
 * @param {number} fromSessionId
 * @param {number} toSessionId
 * @returns {{
 *   studentId         : number,
 *   fromSession       : string,
 *   toSession         : string,
 *   invoicesCarried   : number,
 *   totalAmountCarried: number,
 *   details           : Array
 * }}
 */
async function carryForwardFees(studentId, fromSessionId, toSessionId) {
  return sequelize.transaction(async (t) => {

    // ── Fetch both enrollments ───────────────────────────────────────────
    const [[fromEnrollment]] = await sequelize.query(`
      SELECT e.id, s.name AS session_name
      FROM enrollments e
      JOIN sessions    s ON s.id = e.session_id
      WHERE e.student_id = :studentId AND e.session_id = :fromSessionId
      LIMIT 1;
    `, { replacements: { studentId, fromSessionId }, transaction: t });

    if (!fromEnrollment) {
      throw new Error(
        `No enrollment found for student_id=${studentId} in session_id=${fromSessionId}.`
      );
    }

    const [[toEnrollment]] = await sequelize.query(`
      SELECT e.id, s.name AS session_name
      FROM enrollments e
      JOIN sessions    s ON s.id = e.session_id
      WHERE e.student_id = :studentId AND e.session_id = :toSessionId
      LIMIT 1;
    `, { replacements: { studentId, toSessionId }, transaction: t });

    if (!toEnrollment) {
      throw new Error(
        `No enrollment found for student_id=${studentId} in session_id=${toSessionId}. ` +
        `Create the new session enrollment first.`
      );
    }

    // ── Find all pending/partial invoices in old enrollment ──────────────
    const [unpaidInvoices] = await sequelize.query(`
      SELECT
        fi.id,
        fi.fee_structure_id,
        fi.amount_due,
        fi.amount_paid,
        fi.late_fee_amount,
        fi.concession_amount,
        fi.due_date,
        fs.name   AS fee_name
      FROM fee_invoices  fi
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE fi.enrollment_id = :enrollmentId
        AND fi.status        IN ('pending', 'partial')
      ORDER BY fi.due_date ASC;
    `, { replacements: { enrollmentId: fromEnrollment.id }, transaction: t });

    if (unpaidInvoices.length === 0) {
      return {
        studentId,
        fromSession        : fromEnrollment.session_name,
        toSession          : toEnrollment.session_name,
        invoicesCarried    : 0,
        totalAmountCarried : 0,
        details            : [],
        message            : 'No pending invoices found to carry forward.',
      };
    }

    // ── Find the new session's start date for due_date calculation ────────
    const [[newSession]] = await sequelize.query(`
      SELECT start_date FROM sessions WHERE id = :toSessionId LIMIT 1;
    `, { replacements: { toSessionId }, transaction: t });

    const newDueDate = newSession.start_date; // Carried fees due at start of new session

    const details          = [];
    let totalAmountCarried = 0;

    for (const invoice of unpaidInvoices) {
      // Balance still owed = (amount_due + late_fee - concession) - amount_paid
      const netPayable   = parseFloat(invoice.amount_due)
                         + parseFloat(invoice.late_fee_amount)
                         - parseFloat(invoice.concession_amount);
      const balanceDue   = parseFloat((netPayable - parseFloat(invoice.amount_paid)).toFixed(2));

      if (balanceDue <= 0) continue; // Edge case: concession covered everything

      // ── Create new carried-forward invoice in new session ────────────
      await sequelize.getQueryInterface().bulkInsert('fee_invoices', [{
        enrollment_id         : toEnrollment.id,
        fee_structure_id      : invoice.fee_structure_id,
        amount_due            : balanceDue.toFixed(2),   // Only carry the balance
        amount_paid           : '0.00',
        due_date              : newDueDate,
        paid_date             : null,
        status                : 'pending',
        carry_from_invoice_id : invoice.id,              // ← Link to original
        late_fee_amount       : '0.00',                  // Reset — fresh start
        concession_amount     : '0.00',
        concession_reason     : `Carried forward from session: ${fromEnrollment.session_name}`,
        created_at            : new Date(),
        updated_at            : new Date(),
      }], { transaction: t });

      // ── Mark original invoice as carried_forward ─────────────────────
      await sequelize.query(`
        UPDATE fee_invoices
        SET status     = 'carried_forward',
            updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id: invoice.id }, transaction: t });

      totalAmountCarried += balanceDue;
      details.push({
        originalInvoiceId : invoice.id,
        feeName           : invoice.fee_name,
        originalDueDate   : invoice.due_date,
        amountPaid        : parseFloat(invoice.amount_paid),
        balanceCarried    : balanceDue,
        newDueDate,
      });
    }

    return {
      studentId,
      fromSession        : fromEnrollment.session_name,
      toSession          : toEnrollment.session_name,
      invoicesCarried    : details.length,
      totalAmountCarried : parseFloat(totalAmountCarried.toFixed(2)),
      details,
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 3: applyPayment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies a payment to an invoice and updates its status.
 *
 * Rules:
 *   1. Record payment in fee_payments (immutable ledger)
 *   2. Update invoice.amount_paid
 *   3. Recalculate status: pending → partial → paid
 *   4. If invoice has carry_from_invoice_id and is now fully paid,
 *      mark the original invoice as paid too
 *
 * @param {number} invoiceId
 * @param {{
 *   amount         : number,
 *   paymentDate    : string,  'YYYY-MM-DD'
 *   paymentMode    : 'cash'|'online'|'cheque'|'dd',
 *   transactionRef : string|null,
 *   receivedBy     : number|null,
 * }} paymentData
 *
 * @returns {{
 *   invoiceId      : number,
 *   paymentId      : number,
 *   amountApplied  : number,
 *   totalPaid      : number,
 *   netPayable     : number,
 *   balanceRemaining: number,
 *   newStatus      : string,
 *   originalInvoiceAlsoClosed: boolean,
 * }}
 */
async function applyPayment(invoiceId, paymentData) {
  const { amount, paymentDate, paymentMode, transactionRef, receivedBy, upiId } = paymentData;

  if (!amount || amount <= 0) {
    throw new Error('Payment amount must be greater than 0.');
  }

  return sequelize.transaction(async (t) => {

    // ── Fetch invoice with row lock ───────────────────────────────────────
    const [[invoice]] = await sequelize.query(`
      SELECT
        id,
        enrollment_id,
        amount_due,
        amount_paid,
        late_fee_amount,
        concession_amount,
        status,
        carry_from_invoice_id
      FROM fee_invoices
      WHERE id = :invoiceId
      FOR UPDATE;
    `, { replacements: { invoiceId }, transaction: t });

    if (!invoice) throw new Error(`Invoice id=${invoiceId} not found.`);

    if (invoice.status === 'paid' || invoice.status === 'waived') {
      throw new Error(
        `Invoice id=${invoiceId} is already ${invoice.status}. No payment needed.`
      );
    }

    // ── Calculate net payable and what's still owed ───────────────────────
    const netPayable  = parseFloat(invoice.amount_due)
                      + parseFloat(invoice.late_fee_amount)
                      - parseFloat(invoice.concession_amount);
    const alreadyPaid = parseFloat(invoice.amount_paid);
    const remaining   = parseFloat((netPayable - alreadyPaid).toFixed(2));

    // Cap payment at what's actually owed (prevent overpayment)
    const amountToApply = parseFloat(Math.min(amount, remaining).toFixed(2));
    const newTotalPaid  = parseFloat((alreadyPaid + amountToApply).toFixed(2));
    const newBalance    = parseFloat((netPayable - newTotalPaid).toFixed(2));

    // ── Determine new status ─────────────────────────────────────────────
    const newStatus = newBalance <= 0 ? 'paid' : 'partial';
    const paidDate  = newStatus === 'paid' ? paymentDate : null;

    // ── Step 1: Insert payment record ────────────────────────────────────
    const insertResult = await sequelize.query(`
      INSERT INTO fee_payments
        (invoice_id, amount, payment_date, payment_mode, transaction_ref, upi_id, received_by, created_at)
      VALUES
        (:invoiceId, :amount, :paymentDate, :paymentMode, :transactionRef, :upiId, :receivedBy, NOW())
      RETURNING id;
    `, {
      replacements: {
        invoiceId,
        amount       : amountToApply.toFixed(2),
        paymentDate,
        paymentMode,
        transactionRef : transactionRef || null,
        upiId          : upiId || null,
        receivedBy     : receivedBy    || null,
      },
      transaction: t,
    });
    const paymentId = insertResult[0][0].id;

    // ── Step 2: Update invoice ────────────────────────────────────────────
    await sequelize.query(`
      UPDATE fee_invoices
      SET
        amount_paid = :newTotalPaid,
        status      = :newStatus,
        paid_date   = :paidDate,
        updated_at  = NOW()
      WHERE id = :invoiceId;
    `, {
      replacements: { newTotalPaid: newTotalPaid.toFixed(2), newStatus, paidDate, invoiceId },
      transaction: t,
    });

    // ── Step 3: If fully paid AND was a carry-forward, close original ─────
    let originalInvoiceAlsoClosed = false;

    if (newStatus === 'paid' && invoice.carry_from_invoice_id) {
      await sequelize.query(`
        UPDATE fee_invoices
        SET
          status     = 'paid',
          paid_date  = :paidDate,
          updated_at = NOW()
        WHERE id = :originalId
          AND status IN ('carried_forward', 'partial', 'pending');
      `, {
        replacements: { paidDate, originalId: invoice.carry_from_invoice_id },
        transaction: t,
      });
      originalInvoiceAlsoClosed = true;
    }

    return {
      invoiceId,
      paymentId,
      amountApplied            : amountToApply,
      totalPaid                : newTotalPaid,
      netPayable,
      balanceRemaining         : newBalance < 0 ? 0 : newBalance,
      newStatus,
      originalInvoiceAlsoClosed,
      carryFromInvoiceId       : invoice.carry_from_invoice_id || null,
    };
  });
  }

  /**
  * Calculates the total pending balance for a student's enrollment.
  * Returns the sum of (amount_due + late_fee - concession - amount_paid)
  * for all invoices in 'pending' or 'partial' status.
  *
  * @param {number} enrollmentId
  * @returns {Promise<number>}
  */
  async function getPendingBalance(enrollmentId) {
  const [[row]] = await sequelize.query(`
    SELECT 
      SUM(amount_due + late_fee_amount - concession_amount - amount_paid) AS balance
    FROM fee_invoices
    WHERE enrollment_id = :enrollmentId
      AND status IN ('pending', 'partial');
  `, { replacements: { enrollmentId } });

  return parseFloat(row?.balance || 0);
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // EXPORTS
  // ─────────────────────────────────────────────────────────────────────────────

  module.exports = {
  generateInvoices,
  carryForwardFees,
  applyPayment,
  getPendingBalance,
  _internal: { buildDueDates },
  };