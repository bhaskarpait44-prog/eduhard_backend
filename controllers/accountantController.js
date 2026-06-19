'use strict';

const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const { 
  Session, 
  School, 
  User, 
  FeeInvoice, 
  FeePayment, 
  FeeStructure, 
  Enrollment, 
  Student, 
  Class, 
  Section,
  sequelize 
} = require('../models');
const feeManager = require('../utils/feeManager');
const feeController = require('./feeController');
const { notifyClass, notifyAllStudents, sendNotification } = require('../utils/notification');
const { invalidateCache } = require('../middlewares/cache');

const PAYMENT_MODES = ['cash', 'online', 'cheque', 'dd', 'upi'];
const CONCESSION_REASONS = [
  'Financial hardship',
  'Scholarship',
  'Staff ward concession',
  'Management decision',
  'RTE',
  'Merit based',
  'Sibling discount',
  'Other',
];

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

async function resolveSessionId(requestedSessionId, schoolId, allowLocked = false) {
  let session = null;
  if (requestedSessionId) {
    session = await Session.findOne({
      where: { id: requestedSessionId, school_id: schoolId },
      attributes: ['id', 'name', 'start_date', 'end_date', 'is_current', 'is_locked']
    });
  }

  if (!session) {
    session = await Session.findOne({
      where: { school_id: schoolId, is_current: true },
      attributes: ['id', 'name', 'start_date', 'end_date', 'is_current', 'is_locked']
    });
  }

  if (session && session.is_locked && !allowLocked) {
    throw new Error('Session is locked. Cannot perform financial writes.');
  }

  return session || null;
}

function buildReceiptNo(paymentId, paymentDate = new Date()) {
  const year = new Date(paymentDate).getFullYear();
  return `RCP-${year}-${String(paymentId).padStart(5, '0')}`;
}

async function writeFinancialAudit(req, tableName, recordId, field, newValue, reason = null, oldValue = null) {
  await sequelize.getQueryInterface().bulkInsert('audit_logs', [{
    table_name: tableName,
    record_id: recordId,
    field_name: field,
    old_value: oldValue == null ? null : String(oldValue),
    new_value: newValue == null ? null : String(newValue),
    changed_by: req.user?.id || null,
    reason,
    ip_address: req.ip || null,
    device_info: (req.headers['user-agent'] || '').slice(0, 299),
    created_at: new Date(),
  }]).catch(() => {});
}

function streamPdf(res, fileName, render) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  doc.pipe(res);
  render(doc);
  doc.end();
}

async function getSchoolProfile(schoolId) {
  const school = await School.findByPk(schoolId, {
    attributes: ['id', 'name', 'address', 'phone', 'email']
  });
  return school || {
    name: 'School',
    address: '',
    phone: '',
    email: '',
  };
}

async function getReceiptPayload(paymentId, schoolId) {
  const [[payment]] = await sequelize.query(`
    SELECT
      fp.id,
      fp.amount,
      fp.payment_date,
      fp.payment_mode,
      fp.transaction_ref,
      fi.id AS invoice_id,
      fi.amount_due,
      fi.amount_paid,
      fi.status,
      fs.name AS fee_name,
      s.id AS student_id,
      s.admission_no,
      e.roll_number AS roll_no,
      s.first_name || ' ' || s.last_name AS student_name,
      c.name AS class_name,
      sec.name AS section_name,
      u.name AS received_by_name
    FROM fee_payments fp
    JOIN fee_invoices fi ON fi.id = fp.invoice_id
    JOIN fee_structures fs ON fs.id = fi.fee_structure_id
    JOIN enrollments e ON e.id = fi.enrollment_id
    JOIN students s ON s.id = e.student_id
    LEFT JOIN classes c ON c.id = e.class_id
    LEFT JOIN sections sec ON sec.id = e.section_id
    LEFT JOIN users u ON u.id = fp.received_by
    WHERE fp.id = :paymentId
      AND s.school_id = :schoolId
    LIMIT 1;
  `, { replacements: { paymentId, schoolId } });

  return payment || null;
}

async function getStudentFinanceSummary(studentId, sessionId, schoolId) {
  const [[student]] = await sequelize.query(`
    SELECT
      s.id,
      s.admission_no,
      e.roll_number AS roll_no,
      s.first_name,
      s.last_name,
      e.id AS enrollment_id,
      c.name AS class_name,
      sec.name AS section_name,
      sess.name AS session_name
    FROM students s
    JOIN enrollments e ON e.student_id = s.id
    JOIN sessions sess ON sess.id = e.session_id
    LEFT JOIN classes c ON c.id = e.class_id
    LEFT JOIN sections sec ON sec.id = e.section_id
    WHERE s.id = :studentId
      AND s.school_id = :schoolId
      AND e.session_id = :sessionId
    ORDER BY e.id DESC
    LIMIT 1;
  `, { replacements: { studentId, schoolId, sessionId } });

  if (!student) return null;

  const [invoices] = await sequelize.query(`
    SELECT
      fi.id,
      fi.due_date,
      fi.amount_due,
      fi.amount_paid,
      fi.late_fee_amount,
      fi.concession_amount,
      fi.concession_reason,
      fi.concession_type,
      fi.concession_reference,
      fi.status,
      fi.carry_from_invoice_id,
      fs.name AS fee_name,
      COALESCE(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid, 0) AS balance
    FROM fee_invoices fi
    JOIN fee_structures fs ON fs.id = fi.fee_structure_id
    WHERE fi.enrollment_id = :enrollmentId
    ORDER BY
      CASE
        WHEN fi.status = 'pending' AND fi.due_date < CURRENT_DATE THEN 0
        WHEN fi.status = 'pending' THEN 1
        WHEN fi.status = 'partial' THEN 2
        WHEN fi.status = 'paid' THEN 3
        ELSE 4
      END,
      fi.due_date ASC,
      fi.id DESC;
  `, { replacements: { enrollmentId: student.enrollment_id } });

  const [payments] = await sequelize.query(`
    SELECT
      fp.id,
      fp.amount,
      fp.payment_date,
      fp.payment_mode,
      fp.transaction_ref,
      fp.invoice_id,
      fs.name AS fee_name,
      COALESCE(NULLIF(fp.transaction_ref, ''), CONCAT('RCP-', EXTRACT(YEAR FROM fp.payment_date)::int, '-', LPAD(fp.id::text, 5, '0'))) AS receipt_no
    FROM fee_payments fp
    JOIN fee_invoices fi ON fi.id = fp.invoice_id
    JOIN fee_structures fs ON fs.id = fi.fee_structure_id
    WHERE fi.enrollment_id = :enrollmentId
    ORDER BY fp.payment_date DESC, fp.id DESC;
  `, { replacements: { enrollmentId: student.enrollment_id } });

  const summary = invoices.reduce((acc, invoice) => {
    acc.total_fee += toNumber(invoice.amount_due);
    acc.total_paid += toNumber(invoice.amount_paid);
    acc.balance += toNumber(invoice.balance);
    acc.concession += toNumber(invoice.concession_amount);
    acc.late_fee += toNumber(invoice.late_fee_amount);
    return acc;
  }, {
    total_fee: 0,
    total_paid: 0,
    balance: 0,
    concession: 0,
    late_fee: 0,
  });

  return {
    student: {
      ...student,
      name: `${student.first_name} ${student.last_name}`.trim(),
    },
    summary,
    invoices,
    payments,
  };
}

async function createFeeNotice(req, {
  title,
  content,
  targetScope,
  classId = null,
  sectionId = null,
  targetStudentId = null,
  expiryDate = null,
}) {
  try {
    const [[notice]] = await sequelize.query(`
      INSERT INTO teacher_notices (
        teacher_id, created_by_user_id, created_by_role,
        class_id, section_id, target_student_id,
        title, content, category, target_scope,
        publish_date, expiry_date, is_active, created_at, updated_at
      )
      VALUES (
        NULL, :userId, :role, :classId, :sectionId, :targetStudentId,
        :title, :content, 'fee', :targetScope,
        NOW(), :expiryDate, true, NOW(), NOW()
      )
      RETURNING *;
    `, {
      replacements: {
        userId: req.user.id,
        role: req.user.role,
        classId,
        sectionId,
        targetStudentId,
        title,
        content,
        targetScope,
        expiryDate,
      },
    });

    await writeFinancialAudit(req, 'teacher_notices', notice.id, 'created', title, 'Accountant fee notice created');

    if (targetScope === 'all_students') {
      await notifyAllStudents(req.user.school_id, title, content, 'notice', { notice_id: notice.id, category: 'fee' });
    } else if (targetScope === 'whole_class' || targetScope === 'specific_section') {
      await notifyClass(classId, sectionId, title, content, 'notice', { notice_id: notice.id, category: 'fee' });
    } else if (targetScope === 'specific_student') {
      await sendNotification({ studentId: targetStudentId, title, content, type: 'notice', data: { notice_id: notice.id, category: 'fee' } });
    }

    return notice;
  } catch (error) {
    console.error('[Fee Notice Error]', error);
    throw error;
  }
}

async function ensureClassBelongsToSchool(classId, schoolId) {
  return await Class.findOne({
    where: { id: classId, school_id: schoolId, is_deleted: false },
    attributes: ['id']
  });
}

async function ensureStudentBelongsToSchool(studentId, schoolId) {
  return await Student.findOne({
    where: { id: studentId, school_id: schoolId, is_deleted: false },
    attributes: ['id']
  });
}

exports.getDashboard = feeController.getDashboard;

exports.getTodayStats = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const [[today]] = await sequelize.query(`
      SELECT
        COALESCE(SUM(fp.amount), 0) AS total_amount,
        COUNT(fp.id)::int AS transaction_count
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fp.payment_date = CURRENT_DATE;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    const [[yesterday]] = await sequelize.query(`
      SELECT COALESCE(SUM(fp.amount), 0) AS total_amount
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fp.payment_date = CURRENT_DATE - INTERVAL '1 day';
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    const [modeBreakdown] = await sequelize.query(`
      SELECT fp.payment_mode, COALESCE(SUM(fp.amount), 0) AS amount, COUNT(fp.id)::int AS transaction_count
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fp.payment_date = CURRENT_DATE
      GROUP BY fp.payment_mode
      ORDER BY amount DESC;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    const [[pendingToday]] = await sequelize.query(`
      SELECT
        COUNT(DISTINCT e.student_id)::int AS student_count,
        COUNT(fi.id)::int AS invoice_count,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS amount
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
        AND fi.due_date <= CURRENT_DATE;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    const [[monthStats]] = await sequelize.query(`
      SELECT COALESCE(SUM(fp.amount), 0) AS total_amount, COUNT(fp.id)::int AS transaction_count
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND DATE_TRUNC('month', fp.payment_date::date) = DATE_TRUNC('month', CURRENT_DATE);
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    const [[target]] = await sequelize.query(`
      SELECT target_amount
      FROM collection_targets
      WHERE school_id = :schoolId
        AND session_id = :sessionId
        AND month = EXTRACT(MONTH FROM CURRENT_DATE)::int
        AND year = EXTRACT(YEAR FROM CURRENT_DATE)::int
      LIMIT 1;
    `, { replacements: { schoolId: req.user.school_id, sessionId: session.id } }).catch(() => [[null]]);

    const [[sessionOverview]] = await sequelize.query(`
      SELECT
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS total_expected,
        COALESCE(SUM(fi.amount_paid), 0) AS total_collected,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS total_pending
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    res.ok({
      session,
      today: {
        ...today,
        difference_from_yesterday: toNumber(today.total_amount) - toNumber(yesterday?.total_amount),
        mode_breakdown: modeBreakdown,
      },
      pending_today: pendingToday,
      month: {
        ...monthStats,
        target_amount: toNumber(target?.target_amount),
      },
      session_overview: {
        ...sessionOverview,
        collection_percentage: toNumber(sessionOverview?.total_expected) > 0
          ? Number(((toNumber(sessionOverview.total_collected) / toNumber(sessionOverview.total_expected)) * 100).toFixed(2))
          : 0,
      },
    }, 'Accountant daily statistics loaded.');
  } catch (err) { next(err); }
};

exports.getRecentTransactions = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const [transactions] = await sequelize.query(`
      SELECT
        fp.id,
        fp.payment_date,
        fp.amount,
        fp.payment_mode,
        COALESCE(NULLIF(fp.transaction_ref, ''), CONCAT('RCP-', EXTRACT(YEAR FROM fp.payment_date)::int, '-', LPAD(fp.id::text, 5, '0'))) AS receipt_no,
        s.id AS student_id,
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        sec.name AS section_name
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
      ORDER BY fp.created_at DESC, fp.id DESC
      LIMIT 10;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    res.ok({ transactions }, 'Recent transactions loaded.');
  } catch (err) { next(err); }
};

exports.getPendingTasks = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const [[dueToday]] = await sequelize.query(`
      SELECT COUNT(DISTINCT e.student_id)::int AS student_count, COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS amount
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
        AND fi.due_date = CURRENT_DATE;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    const [[overdue]] = await sequelize.query(`
      SELECT COUNT(DISTINCT e.student_id)::int AS student_count
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
        AND fi.due_date <= CURRENT_DATE - INTERVAL '30 days';
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    const [[pendingCheques]] = await sequelize.query(`
      SELECT COUNT(*)::int AS count
      FROM cheque_payments cp
      JOIN fee_payments fp ON fp.id = cp.payment_id
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE cp.status = 'pending'
        AND e.session_id = :sessionId
        AND s.school_id = :schoolId;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } }).catch(() => [[{ count: 0 }]]);

    const [[carryForwardPending]] = await sequelize.query(`
      SELECT COUNT(*)::int AS count
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
        AND fi.due_date < CURRENT_DATE - INTERVAL '60 days';
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    res.ok({
      tasks: [
        { key: 'due_today', label: 'Students have fees due today', count: dueToday.student_count, amount: dueToday.amount, route: '/accountant/collect' },
        { key: 'pending_cheques', label: 'Cheques pending clearance', count: pendingCheques.count, route: '/accountant/cheques' },
        { key: 'overdue_30', label: 'Overdue students (30+ days)', count: overdue.student_count, route: '/accountant/defaulters' },
        { key: 'carry_forward', label: 'Carry forward review pending', count: carryForwardPending.count, route: '/accountant/carry-forward' },
      ],
    }, 'Pending accountant tasks loaded.');
  } catch (err) { next(err); }
};

exports.getWeekTrend = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const [rows] = await sequelize.query(`
      SELECT
        day::date AS collection_date,
        COALESCE(SUM(fp.amount), 0) AS amount
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') day
      LEFT JOIN fee_payments fp
        ON fp.payment_date = day::date
      LEFT JOIN fee_invoices fi
        ON fi.id = fp.invoice_id
      LEFT JOIN enrollments e
        ON e.id = fi.enrollment_id
       AND e.session_id = :sessionId
      LEFT JOIN students s
        ON s.id = e.student_id
       AND s.school_id = :schoolId
      GROUP BY day
      ORDER BY day ASC;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    res.ok({ trend: rows }, 'Weekly collection trend loaded.');
  } catch (err) { next(err); }
};

exports.searchStudents = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.ok({ students: [] });

    const [students] = await sequelize.query(`
      SELECT
        s.id,
        s.admission_no,
        e.roll_number AS roll_no,
        s.first_name,
        s.last_name,
        e.id AS enrollment_id,
        c.name AS class_name,
        sec.name AS section_name,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS pending_amount
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.session_id = :sessionId
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN fee_invoices fi
        ON fi.enrollment_id = e.id
       AND fi.status IN ('pending', 'partial')
      WHERE s.school_id = :schoolId
        AND (
          s.admission_no ILIKE :query
          OR CONCAT(s.first_name, ' ', s.last_name) ILIKE :query
        )
      GROUP BY s.id, e.id, e.roll_number, c.name, sec.name
      ORDER BY pending_amount DESC, s.first_name
      LIMIT 10;
    `, {
      replacements: {
        sessionId: session.id,
        schoolId: req.user.school_id,
        query: `%${q}%`,
      },
    });

    res.ok({ students }, 'Students loaded.');
  } catch (err) { next(err); }
};

exports.getStudentPendingInvoices = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const payload = await getStudentFinanceSummary(req.params.id, session.id, req.user.school_id);
    if (!payload) return res.fail('Student not found in current session.', [], 404);

    const pending = payload.invoices.filter((invoice) => ['pending', 'partial'].includes(invoice.status));
    const carried = pending.filter((invoice) => invoice.carry_from_invoice_id);
    const current = pending.filter((invoice) => !invoice.carry_from_invoice_id);

    res.ok({
      student: payload.student,
      summary: payload.summary,
      pending_invoices: current,
      carried_forward_invoices: carried,
    }, 'Pending student invoices loaded.');
  } catch (err) { next(err); }
};

exports.collectFees = async (req, res, next) => {
  try {
    const {
      student_id,
      invoice_ids = [],
      amount,
      payment_mode,
      payment_date,
      reference,
      remarks,
      bank_name,
      cheque_number,
      cheque_date,
      branch_name,
      upi_id,
    } = req.body;

    const paymentAmount = toNumber(amount);
    if (!student_id || !Array.isArray(invoice_ids) || invoice_ids.length === 0 || paymentAmount <= 0) {
      return res.fail('student_id, invoice_ids, and amount are required.', [], 422);
    }
    if (!PAYMENT_MODES.includes(payment_mode)) {
      return res.fail('Unsupported payment mode.', [], 422);
    }

    const session = await resolveSessionId(req.body.session_id, req.user.school_id);
    if (!session) return res.fail('No active session found.', [], 404);

    const [invoices] = await sequelize.query(`
      SELECT
        fi.id,
        fi.enrollment_id,
        fs.name AS fee_name,
        fi.amount_due,
        fi.amount_paid,
        fi.late_fee_amount,
        fi.concession_amount,
        fi.status,
        fi.due_date
      FROM fee_invoices fi
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE fi.id IN (:invoiceIds)
        AND s.id = :studentId
        AND s.school_id = :schoolId
        AND e.session_id = :sessionId
        AND fi.status IN ('pending', 'partial')
      ORDER BY fi.due_date ASC, fi.id ASC;
    `, {
      replacements: {
        invoiceIds: invoice_ids,
        studentId: student_id,
        schoolId: req.user.school_id,
        sessionId: session.id,
      },
    });

    if (invoices.length === 0) {
      return res.fail('No eligible invoices found for this payment.', [], 404);
    }

    let remaining = paymentAmount;
    const applied = [];

    await sequelize.transaction(async (t) => {
      for (const invoice of invoices) {
        if (remaining <= 0) break;
        const balance = toNumber(invoice.amount_due) + toNumber(invoice.late_fee_amount) - toNumber(invoice.concession_amount) - toNumber(invoice.amount_paid);
        if (balance <= 0) continue;

        const allocation = Math.min(remaining, balance);
        const result = await feeManager.applyPayment(invoice.id, {
          amount: allocation,
          paymentDate: payment_date,
          paymentMode: payment_mode,
          transactionRef: reference || null,
          receivedBy: req.user.id,
          upiId: upi_id || null,
        }, { transaction: t });

        if (payment_mode === 'cheque') {
          await sequelize.query(`
            INSERT INTO cheque_payments
              (payment_id, cheque_number, bank_name, branch_name, cheque_date, received_date, status, created_at, updated_at)
            VALUES
              (:paymentId, :chequeNumber, :bankName, :branchName, :chequeDate, :receivedDate, 'pending', NOW(), NOW());
          `, {
            replacements: {
              paymentId: result.paymentId,
              chequeNumber: cheque_number || reference || `CHQ-${result.paymentId}`,
              bankName: bank_name || 'Bank not provided',
              branchName: branch_name || null,
              chequeDate: cheque_date || payment_date,
              receivedDate: payment_date,
            },
            transaction: t,
          });
        }

        await writeFinancialAudit(
          req,
          'fee_payments',
          result.paymentId,
          'collection',
          `${allocation} via ${payment_mode}`,
          remarks || `Collected for invoice ${invoice.id}`
        );

        applied.push({
          payment_id: result.paymentId,
          invoice_id: invoice.id,
          fee_name: invoice.fee_name,
          amount_applied: allocation,
          new_status: result.newStatus,
          receipt_no: buildReceiptNo(result.paymentId, payment_date),
        });
        remaining = Number((remaining - allocation).toFixed(2));
      }
    });

    res.ok({
      student_id,
      total_requested: paymentAmount,
      total_applied: Number((paymentAmount - remaining).toFixed(2)),
      unapplied_amount: remaining,
      receipt_no: applied[0]?.receipt_no || null,
      payments: applied,
      meta: {
        payment_mode,
        payment_date,
        reference: reference || null,
        bank_name: bank_name || null,
        cheque_number: cheque_number || null,
        upi_id: upi_id || null,
      },
    }, 'Fee collection completed.', 201);

    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    invalidateCache(req.user.school_id, '/api/accountant*');
    invalidateCache(req.user.school_id, '/api/student*');
  } catch (err) { next(err); }
};

exports.getReceipt = async (req, res, next) => {
  try {
    const receipt = await getReceiptPayload(req.params.id, req.user.school_id);
    if (!receipt) return res.fail('Receipt not found.', [], 404);
    const school = await getSchoolProfile(req.user.school_id);

    res.ok({
      school,
      receipt: {
        ...receipt,
        receipt_no: buildReceiptNo(receipt.id, receipt.payment_date),
        balance_after: Math.max(0, toNumber(receipt.amount_due) + toNumber(receipt.late_fee_amount) - toNumber(receipt.concession_amount) - toNumber(receipt.amount_paid)),
      }
    }, 'Receipt loaded.');
  } catch (err) { next(err); }
};

exports.getReceiptPdf = async (req, res, next) => {
  try {
    const receipt = await getReceiptPayload(req.params.id, req.user.school_id);
    if (!receipt) return res.fail('Receipt not found.', [], 404);
    const school = await getSchoolProfile(req.user.school_id);

    streamPdf(res, `${buildReceiptNo(receipt.id, receipt.payment_date)}.pdf`, (doc) => {
      doc.fontSize(18).text(school.name, { align: 'center' });
      doc.fontSize(10).text(school.address || '', { align: 'center' });
      doc.text(school.phone || '', { align: 'center' });
      doc.moveDown();
      doc.fontSize(16).text('FEE RECEIPT', { align: 'center' });
      doc.moveDown();
      doc.fontSize(11);
      doc.text(`Receipt No: ${buildReceiptNo(receipt.id, receipt.payment_date)}`);
      doc.text(`Date: ${receipt.payment_date}`);
      doc.text(`Student: ${receipt.student_name}`);
      doc.text(`Admission No: ${receipt.admission_no}`);
      doc.text(`Class: ${receipt.class_name || '-'}  Section: ${receipt.section_name || '-'}`);
      doc.moveDown();
      doc.text(`Fee: ${receipt.fee_name}`);
      doc.text(`Amount Paid: INR ${toNumber(receipt.amount).toFixed(2)}`);
      doc.text(`Mode: ${String(receipt.payment_mode || '').toUpperCase()}`);
      doc.text(`Received by: ${receipt.received_by_name || 'System'}`);
      doc.moveDown();
      doc.text('Thank you for the payment.', { align: 'center' });
    });
  } catch (err) { next(err); }
};

exports.getStudents = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const {
      search = '',
      class_id,
      status = '',
      sort = 'name',
      page = 1,
      limit = 10,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const sortSql = {
      name: 'student_name ASC',
      due: 'balance DESC',
      class: 'class_name ASC, student_name ASC',
      payment: 'last_payment_date DESC NULLS LAST',
    }[sort] || 'student_name ASC';

    const replacements = {
      sessionId: session.id,
      schoolId: req.user.school_id,
      classId: class_id || null,
      search: `%${search}%`,
      status,
      limit: Number(limit),
      offset: Number(offset),
    };

    const [students] = await sequelize.query(`
      SELECT
        s.id,
        s.admission_no,
        e.roll_number AS roll_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        sec.name AS section_name,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS total_due,
        COALESCE(SUM(fi.amount_paid), 0) AS total_paid,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS balance,
        MAX(fp.payment_date) AS last_payment_date,
        CASE
          WHEN COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) <= 0 THEN 'fully_paid'
          WHEN COUNT(*) FILTER (WHERE fi.status = 'waived') > 0 THEN 'waived'
          WHEN COUNT(*) FILTER (WHERE fi.status = 'partial') > 0 THEN 'partial'
          WHEN COUNT(*) FILTER (WHERE fi.status IN ('pending', 'partial') AND fi.due_date < CURRENT_DATE) > 0 THEN 'overdue'
          ELSE 'pending'
        END AS fee_status
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.session_id = :sessionId
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN fee_invoices fi ON fi.enrollment_id = e.id
      LEFT JOIN fee_payments fp ON fp.invoice_id = fi.id
      WHERE s.school_id = :schoolId
        AND (:classId IS NULL OR e.class_id = CAST(:classId AS INTEGER))
        AND (
          :search = '%%'
          OR s.admission_no ILIKE :search
          OR CONCAT(s.first_name, ' ', s.last_name) ILIKE :search
        )
      GROUP BY s.id, e.roll_number, c.name, sec.name
      HAVING (
        :status = ''
        OR (
          :status = 'fully_paid' AND COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) <= 0
        ) OR (
          :status = 'waived' AND COUNT(*) FILTER (WHERE fi.status = 'waived') > 0
        ) OR (
          :status = 'partial' AND COUNT(*) FILTER (WHERE fi.status = 'partial') > 0
        ) OR (
          :status = 'overdue' AND COUNT(*) FILTER (WHERE fi.status IN ('pending', 'partial') AND fi.due_date < CURRENT_DATE) > 0
        ) OR (
          :status = 'pending' AND COUNT(*) FILTER (WHERE fi.status IN ('pending', 'partial')) > 0
        )
      )
      ORDER BY ${sortSql}
      LIMIT :limit OFFSET :offset;
    `, { replacements });

    const [[{ total }]] = await sequelize.query(`
      SELECT COUNT(DISTINCT s.id)::int AS total
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.session_id = :sessionId
      LEFT JOIN fee_invoices fi ON fi.enrollment_id = e.id
      WHERE s.school_id = :schoolId
        AND (:classId IS NULL OR e.class_id = CAST(:classId AS INTEGER))
        AND (
          :search = '%%'
          OR s.admission_no ILIKE :search
          OR CONCAT(s.first_name, ' ', s.last_name) ILIKE :search
        )
      ${status ? `
      AND s.id IN (
        SELECT s2.id
        FROM students s2
        JOIN enrollments e2 ON e2.student_id = s2.id AND e2.session_id = :sessionId
        LEFT JOIN fee_invoices fi2 ON fi2.enrollment_id = e2.id
        GROUP BY s2.id
        HAVING (
          (:status = 'fully_paid' AND COALESCE(SUM(fi2.amount_due + fi2.late_fee_amount - fi2.concession_amount - fi2.amount_paid), 0) <= 0)
          OR (:status = 'waived' AND COUNT(*) FILTER (WHERE fi2.status = 'waived') > 0)
          OR (:status = 'partial' AND COUNT(*) FILTER (WHERE fi2.status = 'partial') > 0)
          OR (:status = 'overdue' AND COUNT(*) FILTER (WHERE fi2.status IN ('pending', 'partial') AND fi2.due_date < CURRENT_DATE) > 0)
          OR (:status = 'pending' AND COUNT(*) FILTER (WHERE fi2.status IN ('pending', 'partial')) > 0)
        )
      )` : ''};
    `, { replacements });

    res.ok({ 
      students, 
      session,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    }, 'Student fee list loaded.');
  } catch (err) { next(err); }
};

exports.getStudentFees = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);
    const payload = await getStudentFinanceSummary(req.params.id, session.id, req.user.school_id);
    if (!payload) return res.fail('Student fee record not found.', [], 404);
    res.ok(payload, 'Student fee details loaded.');
  } catch (err) { next(err); }
};

exports.getStudentInvoices = async (req, res, next) => exports.getStudentFees(req, res, next);

exports.getStudentPayments = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);
    const payload = await getStudentFinanceSummary(req.params.id, session.id, req.user.school_id);
    if (!payload) return res.fail('Student fee record not found.', [], 404);
    res.ok({ payments: payload.payments, student: payload.student }, 'Student payment history loaded.');
  } catch (err) { next(err); }
};

exports.getStudentStatementPdf = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);
    const payload = await getStudentFinanceSummary(req.params.id, session.id, req.user.school_id);
    if (!payload) return res.fail('Student fee record not found.', [], 404);
    const school = await getSchoolProfile(req.user.school_id);

    streamPdf(res, `${payload.student.admission_no}-fee-statement.pdf`, (doc) => {
      // ── Header ─────────────────────────────────────────────────────────────
      doc.fontSize(18).font('Helvetica-Bold').text(school.name, { align: 'center' });
      doc.fontSize(10).font('Helvetica').text(school.address || '', { align: 'center' });
      doc.moveDown();
      doc.fontSize(14).font('Helvetica-Bold').text('FEE STATEMENT', { align: 'center', underline: true });
      doc.moveDown();

      // ── Student Details ───────────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('Student Information');
      doc.font('Helvetica').fontSize(10);
      doc.text(`Name: ${payload.student.name}`);
      doc.text(`Admission No: ${payload.student.admission_no}`);
      doc.text(`Class: ${payload.student.class_name || '-'} ${payload.student.section_name ? `Section ${payload.student.section_name}` : ''}`);
      doc.text(`Session: ${payload.student.session_name}`);
      doc.moveDown();

      // ── Summary Table ─────────────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('Financial Summary');
      doc.moveDown(0.5);
      const startX = 50;
      let currentY = doc.y;
      
      const drawSummaryRow = (label, value) => {
        doc.font('Helvetica').text(label, startX, currentY);
        doc.font('Helvetica-Bold').text(`INR ${toNumber(value).toFixed(2)}`, startX + 150, currentY, { align: 'right', width: 100 });
        currentY += 15;
      };

      drawSummaryRow('Total Fee (Net):', payload.summary.total_fee + payload.summary.late_fee - payload.summary.concession);
      drawSummaryRow('Total Paid:', payload.summary.total_paid);
      drawSummaryRow('Balance Due:', payload.summary.balance);
      doc.y = currentY + 10;
      doc.moveDown();

      // ── Invoices Table ─────────────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('Invoice Details');
      doc.moveDown(0.5);

      const tableTop = doc.y;
      const colX = [50, 200, 280, 360, 440];

      // Header row
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Fee Name', colX[0], tableTop);
      doc.text('Due Date', colX[1], tableTop);
      doc.text('Amount', colX[2], tableTop, { align: 'right', width: 70 });
      doc.text('Paid', colX[3], tableTop, { align: 'right', width: 70 });
      doc.text('Balance', colX[4], tableTop, { align: 'right', width: 70 });
      
      doc.moveTo(50, tableTop + 12).lineTo(540, tableTop + 12).stroke();
      
      let rowY = tableTop + 20;
      doc.font('Helvetica').fontSize(9);

      payload.invoices.forEach((invoice) => {
        if (rowY > 750) {
          doc.addPage();
          rowY = 50;
        }

        doc.text(invoice.fee_name, colX[0], rowY, { width: 140 });
        doc.text(String(invoice.due_date), colX[1], rowY);
        doc.text(toNumber(invoice.amount_due).toFixed(2), colX[2], rowY, { align: 'right', width: 70 });
        doc.text(toNumber(invoice.amount_paid).toFixed(2), colX[3], rowY, { align: 'right', width: 70 });
        doc.text(toNumber(invoice.balance).toFixed(2), colX[4], rowY, { align: 'right', width: 70 });
        
        rowY += 20;
      });

      doc.fontSize(8).font('Helvetica-Oblique').text(`Generated on ${new Date().toLocaleString()}`, 50, rowY + 20);
    });
  } catch (err) { next(err); }
};

exports.getFeeStructure = feeController.getStructures;
exports.downloadFeeStructure = feeController.downloadStructurePdf;
exports.createFeeStructure = feeController.createStructure;
exports.deleteFeeStructure = feeController.deleteStructure;
exports.generateFeeInvoices = feeController.generate;

exports.updateFeeStructure = async (req, res, next) => {
  try {
    const updates = [];
    const replacements = { id: req.params.id };

    ['name', 'amount', 'frequency', 'due_day', 'is_active'].forEach((field) => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = :${field}`);
        replacements[field] = req.body[field];
      }
    });

    if (updates.length === 0) return res.fail('No fee structure fields provided.', [], 422);

    const [[updated]] = await sequelize.query(`
      UPDATE fee_structures
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = :id
      RETURNING *;
    `, { replacements });

    if (!updated) return res.fail('Fee structure not found.', [], 404);
    await writeFinancialAudit(req, 'fee_structures', updated.id, 'updated', JSON.stringify(req.body), 'Fee structure updated');
    res.ok(updated, 'Fee structure updated.');
  } catch (err) { next(err); }
};

exports.copyFeeStructureFromSession = async (req, res, next) => {
  try {
    const { from_session_id, to_session_id, class_id } = req.body;

    const rows = await sequelize.transaction(async (t) => {
      await sequelize.query(`DELETE FROM fee_structures WHERE session_id = :toSessionId AND class_id = :classId;`, {
        replacements: { toSessionId: to_session_id, classId: class_id },
        transaction: t,
      });

      const [inserted] = await sequelize.query(`
        INSERT INTO fee_structures (session_id, class_id, name, amount, frequency, due_day, is_active, created_at, updated_at)
        SELECT :toSessionId, class_id, name, amount, frequency, due_day, is_active, NOW(), NOW()
        FROM fee_structures
        WHERE session_id = :fromSessionId AND class_id = :classId
        RETURNING id;
      `, {
        replacements: {
          fromSessionId: from_session_id,
          toSessionId: to_session_id,
          class_id: class_id,
        },
        transaction: t,
      });
      return inserted;
    });

    res.ok({ copied_count: rows.length }, 'Fee structure copied from previous session.');
  } catch (err) { next(err); }
};

exports.getInvoices = feeController.getInvoices;

exports.getOverdueInvoices = async (req, res, next) => {
  req.query.status = req.query.status || 'pending';
  return feeController.getInvoices(req, res, next);
};

exports.getDueTodayInvoices = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const [invoices] = await sequelize.query(`
      SELECT
        fi.id,
        fi.due_date,
        fi.amount_due,
        fi.amount_paid,
        fi.status,
        fs.name AS fee_name,
        s.first_name || ' ' || s.last_name AS student_name,
        s.admission_no,
        c.name AS class_name,
        COALESCE(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid, 0) AS balance
      FROM fee_invoices fi
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
        AND fi.due_date <= CURRENT_DATE
      ORDER BY fi.due_date ASC, balance DESC;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    res.ok({ invoices }, 'Invoices due today loaded.');
  } catch (err) { next(err); }
};

exports.getReceipts = feeController.getReceipts;
exports.getReceiptById = exports.getReceipt;
exports.getReceiptPdfById = exports.getReceiptPdf;

exports.duplicateReceipt = async (req, res, next) => {
  try {
    const receipt = await getReceiptPayload(req.params.id, req.user.school_id);
    if (!receipt) return res.fail('Receipt not found.', [], 404);
    await writeFinancialAudit(req, 'fee_payments', receipt.id, 'duplicate_receipt', buildReceiptNo(receipt.id, receipt.payment_date), 'Duplicate receipt generated');
    res.ok({
      ...receipt,
      receipt_no: buildReceiptNo(receipt.id, receipt.payment_date),
      duplicate_generated_at: new Date(),
      duplicate_generated_by: req.user.name,
    }, 'Duplicate receipt generated.');
  } catch (err) { next(err); }
};

exports.emailReceipt = async (req, res, next) => {
  try {
    await writeFinancialAudit(req, 'fee_payments', req.params.id, 'email_receipt', 'sent', 'Receipt email triggered');
    res.ok({ id: req.params.id, channel: 'email' }, 'Receipt email queued.');
  } catch (err) { next(err); }
};

exports.whatsappReceipt = async (req, res, next) => {
  try {
    await writeFinancialAudit(req, 'fee_payments', req.params.id, 'whatsapp_receipt', 'sent', 'Receipt WhatsApp triggered');
    res.ok({ id: req.params.id, channel: 'whatsapp' }, 'Receipt WhatsApp queued.');
  } catch (err) { next(err); }
};

exports.getDefaulters = feeController.getDefaulters;
exports.downloadDefaultersPdf = feeController.downloadDefaultersPdf;

exports.sendDefaulterReminder = async (req, res, next) => {
  try {
    const { student_ids = [], type = 'sms', message = '' } = req.body;
    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.fail('student_ids is required.', [], 422);
    }
    const noticeMessage = message || 'Fee reminder: your fee payment is pending. Please clear the outstanding dues as soon as possible.';

    const rows = student_ids.map((studentId) => ({
      school_id: req.user.school_id,
      student_id: studentId,
      invoice_id: null,
      reminder_type: type,
      contact_channel: type,
      message: noticeMessage,
      sent_by: req.user.id,
      sent_at: new Date(),
      status: 'sent',
      created_at: new Date(),
      updated_at: new Date(),
    }));

    await sequelize.getQueryInterface().bulkInsert('fee_reminders', rows).catch(() => {});
    const notices = [];
    for (const studentId of student_ids) {
      const student = await ensureStudentBelongsToSchool(studentId, req.user.school_id);
      if (!student) continue;
      notices.push(await createFeeNotice(req, {
        title: 'Fee Payment Reminder',
        content: noticeMessage,
        targetScope: 'specific_student',
        targetStudentId: Number(studentId),
      }));
    }
    res.ok({ sent: student_ids.length, notices_created: notices.length, type }, 'Reminders sent.');
  } catch (err) { next(err); }
};

exports.sendBulkDefaulterReminder = exports.sendDefaulterReminder;

exports.getNotices = async (req, res, next) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        n.*,
        u.name AS teacher_name,
        n.created_by_role AS teacher_role,
        c.name AS class_name,
        s.first_name || ' ' || s.last_name AS target_student_name,
        COUNT(snr.id)::int AS student_read_count
      FROM teacher_notices n
      JOIN users u ON u.id = n.created_by_user_id
      LEFT JOIN classes c ON c.id = n.class_id
      LEFT JOIN students s ON s.id = n.target_student_id
      LEFT JOIN student_notice_reads snr ON snr.notice_id = n.id
      WHERE n.created_by_user_id = :userId
        AND n.category = 'fee'
      GROUP BY n.id, u.id, c.id, s.id
      ORDER BY n.publish_date DESC;
    `, { replacements: { userId: req.user.id } });
    res.ok({ notices: rows }, `${rows.length} notice(s) found.`);
  } catch (err) { next(err); }
};

exports.createNotice = async (req, res, next) => {
  try {
    const {
      title,
      content,
      audience,
      class_id = null,
      student_id = null,
      expiry_date = null,
    } = req.body || {};

    if (!title || !content || !audience) return res.fail('title, content and audience are required.', [], 422);

    let targetScope = 'all_students';
    let classId = null;
    let targetStudentId = null;

    if (audience === 'all_classes') {
      targetScope = 'all_students';
    } else if (audience === 'class') {
      if (!class_id) return res.fail('class_id is required for class wise notice.', [], 422);
      const klass = await ensureClassBelongsToSchool(Number(class_id), req.user.school_id);
      if (!klass) return res.fail('Class not found.', [], 404);
      targetScope = 'specific_section';
      classId = Number(class_id);
    } else if (audience === 'student') {
      if (!student_id) return res.fail('student_id is required for student notice.', [], 422);
      const student = await ensureStudentBelongsToSchool(Number(student_id), req.user.school_id);
      if (!student) return res.fail('Student not found.', [], 404);
      targetScope = 'specific_student';
      targetStudentId = Number(student_id);
    } else {
      return res.fail('audience must be all_classes, class, or student.', [], 422);
    }

    let finalExpiryDate = expiry_date || null;
    if (finalExpiryDate && /^\d{4}-\d{2}-\d{2}$/.test(finalExpiryDate)) {
      finalExpiryDate = `${finalExpiryDate}T23:59:59`;
    }

    const notice = await createFeeNotice(req, {
      title,
      content,
      targetScope,
      classId,
      targetStudentId,
      expiryDate: finalExpiryDate,
    });

    res.ok({ notice }, 'Fee notice created.', 201);
  } catch (err) { next(err); }
};

exports.getConcessions = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);

    const [rows] = await sequelize.query(`
      SELECT
        fi.id AS invoice_id,
        s.first_name || ' ' || s.last_name AS student_name,
        s.admission_no,
        c.name AS class_name,
        fs.name AS fee_name,
        fi.amount_due AS original_amount,
        fi.concession_amount,
        fi.concession_reason,
        fi.concession_type,
        fi.concession_reference,
        fi.updated_at
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.concession_amount > 0
      ORDER BY fi.updated_at DESC;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });

    res.ok({ concessions: rows, reasons: CONCESSION_REASONS }, 'Concessions loaded.');
  } catch (err) { next(err); }
};

exports.applyConcession = async (req, res, next) => {
  try {
    const {
      invoice_id,
      concession_type,
      concession_value,
      reason,
      approval_reference,
      remarks,
    } = req.body;

    const [[invoice]] = await sequelize.query(`
      SELECT fi.id, fi.amount_due, fi.concession_amount, fi.status, s.school_id
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE fi.id = :invoiceId
      LIMIT 1;
    `, { replacements: { invoiceId: invoice_id } });

    if (!invoice) return res.fail('Invoice not found.', [], 404);
    if (invoice.school_id !== req.user.school_id) return res.fail('Unauthorized access to invoice.', [], 403);
    if (['paid', 'waived'].includes(invoice.status)) {
      return res.fail(`Cannot apply concession to an invoice that is already ${invoice.status}.`, [], 422);
    }

    const originalAmount = toNumber(invoice.amount_due);
    let concessionAmount = 0;

    if (concession_type === 'percentage') concessionAmount = Number(((originalAmount * toNumber(concession_value)) / 100).toFixed(2));
    else if (concession_type === 'fixed') concessionAmount = toNumber(concession_value);
    else concessionAmount = originalAmount;

    concessionAmount = Math.min(concessionAmount, originalAmount);

    const [[updated]] = await sequelize.query(`
      UPDATE fee_invoices
      SET
        concession_amount = :concessionAmount,
        concession_reason = :reason,
        concession_type = :concessionType,
        concession_reference = :approvalReference,
        updated_at = NOW()
      WHERE id = :invoiceId
      RETURNING *;
    `, {
      replacements: {
        invoiceId: invoice_id,
        concessionAmount,
        reason: remarks ? `${reason}${reason ? ' | ' : ''}${remarks}` : reason,
        concessionType: concession_type,
        approvalReference: approval_reference || null,
      },
    });

    await writeFinancialAudit(req, 'fee_invoices', updated.id, 'concession', concessionAmount, reason, invoice.concession_amount);
    res.ok({
      invoice: updated,
      preview: {
        original_amount: originalAmount,
        concession_amount: concessionAmount,
        final_amount: Number((originalAmount - concessionAmount).toFixed(2)),
      },
    }, 'Concession applied successfully.');

    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    invalidateCache(req.user.school_id, '/api/accountant*');
    invalidateCache(req.user.school_id, '/api/student*');
  } catch (err) { next(err); }
};

exports.getConcessionReport = exports.getConcessions;

exports.getDailyReport = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [transactions] = await sequelize.query(`
      SELECT
        fp.id,
        fp.payment_date,
        fp.amount,
        fp.payment_mode,
        fs.name AS fee_name,
        s.first_name || ' ' || s.last_name AS student_name,
        s.admission_no,
        c.name AS class_name
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      WHERE s.school_id = :schoolId
        AND fp.payment_date = :date
      ORDER BY fp.id DESC;
    `, { replacements: { schoolId: req.user.school_id, date } });

    const summary = transactions.reduce((acc, row) => {
      acc.total_collection += toNumber(row.amount);
      acc.total_transactions += 1;
      acc.by_mode[row.payment_mode] = acc.by_mode[row.payment_mode] || { amount: 0, count: 0 };
      acc.by_mode[row.payment_mode].amount += toNumber(row.amount);
      acc.by_mode[row.payment_mode].count += 1;
      return acc;
    }, { total_collection: 0, total_transactions: 0, by_mode: {} });

    res.ok({ date, summary, transactions }, 'Daily report loaded.');
  } catch (err) { next(err); }
};

exports.getMonthlyReport = async (req, res, next) => {
  try {
    const month = Number(req.query.month || new Date().getMonth() + 1);
    const year = Number(req.query.year || new Date().getFullYear());

    const [days] = await sequelize.query(`
      SELECT
        fp.payment_date AS date,
        COALESCE(SUM(fp.amount), 0) AS collection,
        COUNT(fp.id)::int AS transactions
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE s.school_id = :schoolId
        AND EXTRACT(MONTH FROM fp.payment_date::date) = :month
        AND EXTRACT(YEAR FROM fp.payment_date::date) = :year
      GROUP BY fp.payment_date
      ORDER BY fp.payment_date;
    `, { replacements: { schoolId: req.user.school_id, month, year } });

    res.ok({ month, year, days }, 'Monthly report loaded.');
  } catch (err) { next(err); }
};

exports.getClasswiseReport = feeController.getReport;
exports.getSessionReport = feeController.getDashboard;
exports.getDefaulterReport = feeController.getDefaulters;
exports.getConcessionsReport = exports.getConcessionReport;

exports.buildCustomReport = async (req, res, next) => {
  try {
    const { filters = {}, include = {} } = req.body || {};
    const session = await resolveSessionId(filters.session_id, req.user.school_id);
    if (!session) return res.fail('No active session found.', [], 404);
    const payload = await sequelize.query(`
      SELECT
        s.id,
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        sec.name AS section_name,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount), 0) AS total_due,
        COALESCE(SUM(fi.amount_paid), 0) AS total_paid,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS balance
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.session_id = :sessionId
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN fee_invoices fi ON fi.enrollment_id = e.id
      WHERE s.school_id = :schoolId
      GROUP BY s.id, c.name, sec.name
      ORDER BY student_name;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });
    res.ok({ include, filters, rows: payload[0] }, 'Custom report built.');
  } catch (err) { next(err); }
};

exports.getCarryForwardEligible = async (req, res, next) => {
  try {
    const session = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!session) return res.fail('No active session found.', [], 404);
    const [students] = await sequelize.query(`
      SELECT
        s.id AS student_id,
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        COUNT(fi.id)::int AS invoices_count,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS total_pending
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
      GROUP BY s.id, c.name
      ORDER BY total_pending DESC;
    `, { replacements: { sessionId: session.id, schoolId: req.user.school_id } });
    res.ok({ students }, 'Carry-forward eligible students loaded.');
  } catch (err) { next(err); }
};

exports.carryForwardSingle = async (req, res, next) => {
  try {
    const { student_id, from_session_id, to_session_id } = req.body;
    
    const result = await sequelize.transaction(async (t) => {
      const carryResult = await feeManager.carryForwardFees(student_id, from_session_id, to_session_id, { transaction: t });
      
      for (const row of carryResult.details || []) {
        await sequelize.query(`
          INSERT INTO fee_carry_forwards
            (old_session_id, new_session_id, student_id, old_invoice_id, amount, carried_by, carried_at, notes, created_at, updated_at)
          VALUES
            (:oldSessionId, :newSessionId, :studentId, :oldInvoiceId, :amount, :carriedBy, NOW(), :notes, NOW(), NOW());
        `, {
          replacements: {
            oldSessionId: from_session_id,
            newSessionId: to_session_id,
            studentId: student_id,
            oldInvoiceId: row.originalInvoiceId,
            amount: row.balanceCarried,
            carriedBy: req.user.id,
            notes: `Auto carry forward to ${carryResult.toSession}`,
          },
          transaction: t,
        });
      }
      return carryResult;
    });

    res.ok(result, 'Carry forward completed.');
  } catch (err) { next(err); }
};

exports.carryForwardBulk = async (req, res, next) => {
  try {
    const { student_ids = [], from_session_id, to_session_id } = req.body;
    const results = [];
    
    for (const studentId of student_ids) {
      try {
        const studentResult = await sequelize.transaction(async (t) => {
          const carryResult = await feeManager.carryForwardFees(studentId, from_session_id, to_session_id, { transaction: t });
          
          for (const row of carryResult.details || []) {
            await sequelize.query(`
              INSERT INTO fee_carry_forwards
                (old_session_id, new_session_id, student_id, old_invoice_id, amount, carried_by, carried_at, notes, created_at, updated_at)
              VALUES
                (:oldSessionId, :newSessionId, :studentId, :oldInvoiceId, :amount, :carriedBy, NOW(), :notes, NOW(), NOW());
            `, {
              replacements: {
                oldSessionId: from_session_id,
                newSessionId: to_session_id,
                studentId: studentId,
                oldInvoiceId: row.originalInvoiceId,
                amount: row.balanceCarried,
                carriedBy: req.user.id,
                notes: `Bulk carry forward to ${carryResult.toSession}`,
              },
              transaction: t,
            });
          }
          return carryResult;
        });
        results.push({ student_id: studentId, status: 'success', data: studentResult });
      } catch (err) {
        results.push({ student_id: studentId, status: 'error', message: err.message });
      }
    }
    
    res.ok({ results, processed: results.length }, 'Bulk carry forward completed.');
  } catch (err) { next(err); }
};

exports.getRefunds = async (req, res, next) => {
  try {
    const [refunds] = await sequelize.query(`
      SELECT
        fr.id,
        fr.amount,
        fr.reason,
        fr.refund_method,
        fr.reference_number,
        fr.status,
        fr.processed_at,
        s.first_name || ' ' || s.last_name AS student_name,
        s.admission_no,
        u.name AS processed_by_name
      FROM fee_refunds fr
      JOIN students s ON s.id = fr.student_id
      LEFT JOIN users u ON u.id = fr.processed_by
      WHERE s.school_id = :schoolId
      ORDER BY fr.created_at DESC;
    `, { replacements: { schoolId: req.user.school_id } }).catch(() => [[]]);
    res.ok({ refunds }, 'Refund list loaded.');
  } catch (err) { next(err); }
};

exports.processRefund = async (req, res, next) => {
  try {
    const {
      student_id,
      payment_id,
      invoice_id,
      amount,
      reason,
      refund_method,
      reference_number,
    } = req.body;

    const [[refund]] = await sequelize.query(`
      INSERT INTO fee_refunds
        (student_id, payment_id, invoice_id, amount, reason, refund_method, reference_number, status, processed_by, processed_at, created_at)
      VALUES
        (:studentId, :paymentId, :invoiceId, :amount, :reason, :refundMethod, :referenceNumber, 'processed', :processedBy, NOW(), NOW())
      RETURNING *;
    `, {
      replacements: {
        studentId: student_id,
        paymentId: payment_id,
        invoiceId: invoice_id || null,
        amount,
        reason,
        refundMethod: refund_method,
        referenceNumber: reference_number || null,
        processedBy: req.user.id,
      },
    });

    await writeFinancialAudit(req, 'fee_refunds', refund.id, 'refund', amount, reason);
    res.ok(refund, 'Refund processed successfully.', 201);

    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    invalidateCache(req.user.school_id, '/api/accountant*');
    invalidateCache(req.user.school_id, '/api/student*');
  } catch (err) { next(err); }
};

exports.getRefundReport = exports.getRefunds;

exports.getCheques = async (req, res, next) => {
  try {
    const [cheques] = await sequelize.query(`
      SELECT
        cp.*,
        fp.amount,
        fp.payment_date,
        s.first_name || ' ' || s.last_name AS student_name,
        s.admission_no
      FROM cheque_payments cp
      JOIN fee_payments fp ON fp.id = cp.payment_id
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE s.school_id = :schoolId
      ORDER BY cp.created_at DESC;
    `, { replacements: { schoolId: req.user.school_id } }).catch(() => [[]]);
    res.ok({ cheques }, 'Cheque register loaded.');
  } catch (err) { next(err); }
};

exports.getPendingCheques = async (req, res, next) => {
  req.query.status = 'pending';
  return exports.getCheques(req, res, next);
};

exports.clearCheque = async (req, res, next) => {
  try {
    const [[cheque]] = await sequelize.query(`
      UPDATE cheque_payments
      SET status = 'cleared', clearance_date = :clearanceDate, cleared_by = :clearedBy, updated_at = NOW()
      WHERE id = :id
      RETURNING *;
    `, {
      replacements: {
        id: req.params.id,
        clearanceDate: req.body.clearance_date || new Date().toISOString().slice(0, 10),
        clearedBy: req.user.id,
      },
    });
    if (!cheque) return res.fail('Cheque not found.', [], 404);
    await writeFinancialAudit(req, 'cheque_payments', cheque.id, 'status', 'cleared', 'Cheque cleared');
    res.ok(cheque, 'Cheque marked as cleared.');

    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    invalidateCache(req.user.school_id, '/api/accountant*');
  } catch (err) { next(err); }
};

exports.bounceCheque = async (req, res, next) => {
  try {
    const [[cheque]] = await sequelize.query(`
      UPDATE cheque_payments
      SET status = 'bounced', bounce_reason = :reason, bounce_date = :bounceDate, bounce_charge = :bounceCharge, updated_at = NOW()
      WHERE id = :id
      RETURNING *;
    `, {
      replacements: {
        id: req.params.id,
        reason: req.body.bounce_reason || 'Cheque bounced',
        bounceDate: req.body.bounce_date || new Date().toISOString().slice(0, 10),
        bounceCharge: req.body.bounce_charge || 0,
      },
    });
    if (!cheque) return res.fail('Cheque not found.', [], 404);
    await writeFinancialAudit(req, 'cheque_payments', cheque.id, 'status', 'bounced', cheque.bounce_reason);
    res.ok(cheque, 'Cheque marked as bounced.');

    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    invalidateCache(req.user.school_id, '/api/accountant*');
  } catch (err) { next(err); }
};

exports.getUpiRequests = async (req, res, next) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    const schoolId = req.user.school_id;
    const offset = (Number(page) - 1) * Number(limit);

    const [requests] = await sequelize.query(`
      SELECT
        upr.*,
        s.first_name || ' ' || s.last_name AS student_name,
        s.admission_no,
        c.name AS class_name,
        sec.name AS section_name,
        fs.name AS fee_name,
        fi.due_date,
        u.name AS confirmed_by_name
      FROM upi_payment_requests upr
      JOIN enrollments e ON e.id = upr.enrollment_id
      JOIN students s ON s.id = e.student_id
      JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      JOIN fee_invoices fi ON fi.id = upr.invoice_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      LEFT JOIN users u ON u.id = upr.confirmed_by
      WHERE s.school_id = :schoolId
        ${status !== 'all' ? 'AND upr.status = :status' : ''}
      ORDER BY upr.created_at DESC
      LIMIT :limit OFFSET :offset;
    `, { replacements: { schoolId, status, limit: Number(limit), offset } });

    const [[{ total }]] = await sequelize.query(`
      SELECT COUNT(*) AS total
      FROM upi_payment_requests upr
      JOIN enrollments e ON e.id = upr.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE s.school_id = :schoolId
        ${status !== 'all' ? 'AND upr.status = :status' : ''};
    `, { replacements: { schoolId, status } });

    res.ok({ 
      requests, 
      pagination: {
        total: Number(total),
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(Number(total) / Number(limit))
      }
    });
  } catch (err) { next(err); }
};
exports.confirmUpiRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { transaction_ref } = req.body;
    const adminId = req.user.id;

    await sequelize.transaction(async (t) => {
      const [[request]] = await sequelize.query(`
        SELECT * FROM upi_payment_requests WHERE id = :id FOR UPDATE;
      `, { replacements: { id }, transaction: t });

      if (!request) throw new Error('Request not found.');
      if (request.status !== 'pending') throw new Error(`Request is already ${request.status}.`);

      const feeManager = require('../utils/feeManager');
      const paymentDate = new Date().toISOString().slice(0, 10);

      // Call existing payment logic
      await feeManager.applyPayment(request.invoice_id, {
        amount: request.amount,
        paymentDate,
        paymentMode: 'upi',
        transactionRef: transaction_ref || request.upi_transaction_id,
        receivedBy: adminId,
      }, { transaction: t });

      // Update request status
      await sequelize.query(`
        UPDATE upi_payment_requests
        SET status = 'confirmed', confirmed_by = :adminId, confirmed_at = NOW(), updated_at = NOW()
        WHERE id = :id;
      `, { replacements: { id, adminId }, transaction: t });
    });

    res.ok({}, 'UPI payment confirmed successfully.');

    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
    invalidateCache(req.user.school_id, '/api/accountant*');
    invalidateCache(req.user.school_id, '/api/student*');

    // Notify student
    try {
      const [[studentInfo]] = await sequelize.query(`
        SELECT e.student_id, fs.name AS fee_name
        FROM upi_payment_requests upr
        JOIN enrollments e ON e.id = upr.enrollment_id
        JOIN fee_invoices fi ON fi.id = upr.invoice_id
        JOIN fee_structures fs ON fs.id = fi.fee_structure_id
        WHERE upr.id = :id
        LIMIT 1;
      `, { replacements: { id } });

      if (studentInfo) {
        await sendNotification({
          studentId: studentInfo.student_id,
          title: 'Payment Confirmed',
          content: `Your UPI payment for ${studentInfo.fee_name} has been confirmed. Thank you!`,
          type: 'fee_payment',
          data: { requestId: id }
        });
      }
    } catch (notifyErr) {
      console.error('[UPI-Notify-Student-Error]', notifyErr);
    }
  } catch (err) { next(err); }
};

exports.rejectUpiRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) return res.fail('Rejection reason is required.', [], 422);

    const [[updated]] = await sequelize.query(`
      UPDATE upi_payment_requests
      SET status = 'rejected', rejected_reason = :reason, updated_at = NOW()
      WHERE id = :id AND status = 'pending'
      RETURNING id;
    `, { replacements: { id, reason } });

    if (!updated) return res.fail('Request not found or already processed.', [], 404);

    res.ok({}, 'UPI payment request rejected.');

    // Notify student
    try {
      const [[studentInfo]] = await sequelize.query(`
        SELECT e.student_id, fs.name AS fee_name
        FROM upi_payment_requests upr
        JOIN enrollments e ON e.id = upr.enrollment_id
        JOIN fee_invoices fi ON fi.id = upr.invoice_id
        JOIN fee_structures fs ON fs.id = fi.fee_structure_id
        WHERE upr.id = :id
        LIMIT 1;
      `, { replacements: { id } });

      if (studentInfo) {
        await sendNotification({
          studentId: studentInfo.student_id,
          title: 'Payment Request Rejected',
          content: `Your UPI payment for ${studentInfo.fee_name} was rejected. Reason: ${reason}`,
          type: 'fee_payment',
          data: { requestId: id }
        });
      }
    } catch (notifyErr) {
      console.error('[UPI-Reject-Notify-Student-Error]', notifyErr);
    }

    invalidateCache(req.user.school_id, '/api/accountant*');
    invalidateCache(req.user.school_id, '/api/student*');
  } catch (err) { next(err); }
};

exports.getProfile = async (req, res, next) => {
  try {
    const [[profile]] = await sequelize.query(`
      SELECT id, name, email, employee_id, department, designation, joining_date, phone
      FROM users
      WHERE id = :id
      LIMIT 1;
    `, { replacements: { id: req.user.id } });

    res.ok({
      ...profile,
      permissions: req.userPermissions ? Array.from(req.userPermissions).filter((item) => item !== '*') : req.user.permissions || [],
    }, 'Accountant profile loaded.');
  } catch (err) { next(err); }
};

exports.getProfileActivity = async (req, res, next) => {
  try {
    const [[today]] = await sequelize.query(`
      SELECT COUNT(*)::int AS transactions, COALESCE(SUM(amount), 0) AS amount
      FROM fee_payments
      WHERE received_by = :userId
        AND payment_date = CURRENT_DATE;
    `, { replacements: { userId: req.user.id } });

    const [[month]] = await sequelize.query(`
      SELECT COUNT(*)::int AS transactions, COALESCE(SUM(amount), 0) AS amount
      FROM fee_payments
      WHERE received_by = :userId
        AND DATE_TRUNC('month', payment_date::date) = DATE_TRUNC('month', CURRENT_DATE);
    `, { replacements: { userId: req.user.id } });

    res.ok({ today, month }, 'Accountant activity loaded.');
  } catch (err) { next(err); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    const [[user]] = await sequelize.query(`
      SELECT id, password_hash
      FROM users
      WHERE id = :id
      LIMIT 1;
    `, { replacements: { id: req.user.id } });

    if (!user) return res.fail('User not found.', [], 404);

    const matches = await bcrypt.compare(current_password, user.password_hash);
    if (!matches) return res.fail('Current password is incorrect.', [], 422);

    const hash = await bcrypt.hash(new_password, 12);
    await sequelize.query(`
      UPDATE users
      SET password_hash = :hash, force_password_change = false, updated_at = NOW()
      WHERE id = :id;
    `, { replacements: { hash, id: req.user.id } });

    await writeFinancialAudit(req, 'users', req.user.id, 'password_change', 'changed', 'Accountant changed password');
    res.ok({}, 'Password changed successfully.');
  } catch (err) { next(err); }
};
