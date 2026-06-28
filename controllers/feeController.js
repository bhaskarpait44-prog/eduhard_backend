'use strict';

const sequelize  = require('../config/database');
const feeManager = require('../utils/feeManager');
const { invalidateCache } = require('../middlewares/cache');
const { writeAuditLog } = require('../utils/writeAuditLog');

const formatINR = (amount) => {
  return Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

async function syncStructureInvoicesForClass({ structure, transaction }) {
  const [[session]] = await sequelize.query(`
    SELECT id, start_date, end_date
    FROM sessions
    WHERE id = :sessionId
    LIMIT 1;
  `, {
    replacements: { sessionId: structure.session_id },
    transaction,
  });

  if (!session) return { created: 0, skipped: 0 };

  const [enrollments] = await sequelize.query(`
    SELECT id
    FROM enrollments
    WHERE session_id = :sessionId
      AND class_id = :classId
      AND status = 'active';
  `, {
    replacements: {
      sessionId: structure.session_id,
      classId: structure.class_id,
    },
    transaction,
  });

  const dueDates = feeManager._internal.buildDueDates(
    session.start_date,
    session.end_date,
    structure.frequency,
    structure.due_day,
  );

  let created = 0;
  let skipped = 0;

  for (const enrollment of enrollments) {
    for (const { due_date } of dueDates) {
      const [existing] = await sequelize.query(`
        SELECT id
        FROM fee_invoices
        WHERE enrollment_id = :enrollmentId
          AND fee_structure_id = :feeStructureId
          AND due_date = :dueDate
        LIMIT 1;
      `, {
        replacements: {
          enrollmentId: enrollment.id,
          feeStructureId: structure.id,
          dueDate: due_date,
        },
        transaction,
      });

      if (existing.length > 0) {
        skipped += 1;
        continue;
      }

      await sequelize.getQueryInterface().bulkInsert('fee_invoices', [{
        enrollment_id: enrollment.id,
        fee_structure_id: structure.id,
        amount_due: parseFloat(structure.amount).toFixed(2),
        amount_paid: '0.00',
        due_date,
        paid_date: null,
        status: 'pending',
        carry_from_invoice_id: null,
        late_fee_amount: '0.00',
        concession_amount: '0.00',
        concession_reason: null,
        created_at: new Date(),
        updated_at: new Date(),
      }], { transaction });

      created += 1;
    }
  }

  return { created, skipped };
}

async function resolveSessionId(requestedSessionId, schoolId, allowLocked = false) {
  let session = null;
  if (requestedSessionId) {
    const [[selectedSession]] = await sequelize.query(`
      SELECT id, is_locked
      FROM sessions
      WHERE id = :sessionId AND school_id = :schoolId
      LIMIT 1;
    `, {
      replacements: {
        sessionId: requestedSessionId,
        schoolId,
      },
    });
    session = selectedSession;
  }

  if (!session) {
    const [[currentSession]] = await sequelize.query(`
      SELECT id, is_locked
      FROM sessions
      WHERE school_id = :schoolId AND is_current = true
      LIMIT 1;
    `, { replacements: { schoolId } });
    session = currentSession;
  }

  if (session && session.is_locked && !allowLocked) {
    throw new Error('Session is locked. Cannot modify fee records.');
  }

  return session?.id || null;
}


// GET /api/fees/structures - List fee structures
exports.getStructures = async (req, res, next) => {
  try {
    const { session_id, class_id } = req.query;

    let sql = `
      SELECT fs.*, c.name AS class_name
      FROM fee_structures fs
      JOIN classes c ON c.id = fs.class_id
      WHERE fs.session_id IN (
        SELECT id FROM sessions WHERE school_id = :schoolId
      )
    `;
    const replacements = { schoolId: req.user.school_id };

    if (session_id) {
      sql += ' AND fs.session_id = :sessionId';
      replacements.sessionId = session_id;
    }

    if (class_id) {
      sql += ' AND fs.class_id = :classId';
      replacements.classId = class_id;
    }

    sql += ' ORDER BY fs.class_id, fs.name';

    const [structures] = await sequelize.query(sql, { replacements });
    res.ok({ structures });
  } catch (err) { next(err); }
};

// GET /api/fees/structure/download - Download professional fee structure PDF
exports.downloadStructurePdf = async (req, res, next) => {
  try {
    const { session_id, class_id } = req.query;
    const schoolId = req.user.school_id;

    if (!session_id) return res.fail('Session ID is required.');

    // 1. Fetch Data
    const [[school]] = await sequelize.query(
      `SELECT name, address, phone, logo_url FROM schools WHERE id = :schoolId LIMIT 1`,
      { replacements: { schoolId } }
    );
    if (!school) return res.fail('School record not found.');

    const [[session]] = await sequelize.query(
      `SELECT name FROM sessions WHERE id = :sessionId AND school_id = :schoolId LIMIT 1`,
      { replacements: { sessionId: session_id, schoolId } }
    );
    if (!session) return res.fail('Academic session not found.');

    let classQuery = '';
    const replacements = { sessionId: session_id, schoolId };
    if (class_id) {
      classQuery = 'AND fs.class_id = :classId';
      replacements.classId = class_id;
    }

    const [structures] = await sequelize.query(`
      SELECT fs.*, c.name AS class_name, c.stream
      FROM fee_structures fs
      JOIN classes c ON c.id = fs.class_id
      WHERE fs.session_id = :sessionId
        AND c.school_id = :schoolId
        AND fs.is_active = true
        ${classQuery}
      ORDER BY c.order_number ASC, fs.frequency DESC, fs.name ASC
    `, { replacements });

    if (!structures || structures.length === 0) {
      return res.fail('No fee components found for the selected session/class.');
    }

    // Group by class
    const classGroups = structures.reduce((acc, curr) => {
      const key = curr.stream ? `${curr.class_name} (${curr.stream})` : curr.class_name;
      if (!acc[key]) acc[key] = [];
      acc[key].push(curr);
      return acc;
    }, {});

    // Helper: formatINR with Rs.
    const formatINR = (amount) =>
      'Rs.' + Number(amount || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    // 2. Setup PDF
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });

    // Set headers before piping
    const safeSessionName = session.name.replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fee_structure_${safeSessionName}.pdf"`);
    doc.pipe(res);

    // Image fetcher helper
    const fetchLogo = async (url) => {
      if (!url) return null;
      const protocol = url.startsWith('https') ? require('https') : require('http');
      return new Promise((resolve) => {
        protocol.get(url, (response) => {
          if (response.statusCode !== 200) return resolve(null);
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', () => resolve(null));
      });
    };

    const logoBuffer = await fetchLogo(school.logo_url);

    // Header Helper
    const drawHeader = () => {
      const pageWidth = doc.page.width;
      const margin = 40;
      const contentWidth = pageWidth - (margin * 2);

      // Header Background (Not full bleed for better printing)
      doc.rect(margin, 20, contentWidth, 100).fill('#1e40af');
      doc.fillColor('white');

      let textX = margin + 15;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, margin + 10, 30, { width: 60, height: 60 });
          textX = margin + 80;
        } catch (e) { /* skip logo if invalid */ }
      }

      doc.font('Helvetica-Bold').fontSize(16).text(school.name.toUpperCase(), textX, 35);
      doc.font('Helvetica').fontSize(8).text(`${school.address || ''} | Phone: ${school.phone || ''}`, textX, 54);

      doc.font('Helvetica-Bold').fontSize(12).text('ACADEMIC FEE STRUCTURE', margin + 15, 85, { characterSpacing: 0.5 });
      doc.fontSize(9).text(`Academic Year: ${session.name} | ${class_id ? `Class: ${structures[0].class_name}` : 'All Classes'}`, margin + 15, 102);

      doc.fontSize(7).text(`Generated: ${new Date().toLocaleDateString()} | By: ${req.user.name}`, margin, 35, { align: 'right', width: contentWidth - 15 });
      doc.moveDown(2);
    };

    drawHeader();
    doc.y = 140;

    // Table Config
    const startX = 40;
    const colWidths = [180, 100, 100, 60, 75];
    const headers = ['Fee Component', 'Frequency', 'Amount (INR)', 'Due Day', 'Remarks'];

    const drawTableHeaders = () => {
      const headerY = doc.y;
      doc.fillColor('#dbeafe').rect(startX, headerY, 515, 22).fill();
      doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(9);
      let curX = startX;
      headers.forEach((h, i) => {
        const align = (i === 2 || i === 3) ? 'right' : 'left';
        doc.text(h, curX + 5, headerY + 7, { width: colWidths[i] - 10, align });
        curX += colWidths[i];
      });
      doc.y = headerY + 22;
      doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(startX, doc.y).lineTo(startX + 515, doc.y).stroke();
    };

    const drawRow = (c, i, rowY, rowHeight) => {
      // Background
      if (i % 2 === 1) {
        doc.fillColor('#f8fafc').rect(startX, rowY, 515, rowHeight).fill();
      }

      doc.fillColor(c.is_optional ? '#64748b' : '#1e293b');
      doc.font(c.is_optional ? 'Helvetica-Oblique' : 'Helvetica').fontSize(9);

      let rx = startX;
      const name = c.is_optional ? `${c.name} (Optional)` : c.name;
      
      doc.text(name, rx + 5, rowY + 7, { width: colWidths[0] - 10 }); rx += colWidths[0];
      doc.text(c.frequency.toUpperCase(), rx + 5, rowY + 7, { width: colWidths[1] - 10 }); rx += colWidths[1];
      doc.text(formatINR(c.amount), rx + 5, rowY + 7, { width: colWidths[2] - 10, align: 'right' }); rx += colWidths[2];
      doc.text(c.due_day || '-', rx + 5, rowY + 7, { width: colWidths[3] - 10, align: 'right' }); rx += colWidths[3];
      doc.text(c.remarks || '-', rx + 5, rowY + 7, { width: colWidths[4] - 10 });

      // Borders
      doc.strokeColor('#e2e8f0').lineWidth(0.5);
      doc.rect(startX, rowY, 515, rowHeight).stroke();
    };

    const classSummaries = [];

    // 3. Render Classes
    Object.keys(classGroups).forEach((className) => {
      const components = classGroups[className];
      const recurringFees = components.filter(c => c.frequency !== 'one_time');
      const oneTimeFees = components.filter(c => c.frequency === 'one_time');

      // Class Title
      if (doc.y > 620) { doc.addPage(); drawHeader(); doc.y = 140; }
      doc.fillColor('#1e40af').font('Helvetica-Bold').fontSize(11).text(className.toUpperCase(), 40, doc.y);
      doc.strokeColor('#1e40af').lineWidth(1).moveTo(40, doc.y + 13).lineTo(150, doc.y + 13).stroke();
      doc.moveDown(1.5);

      drawTableHeaders();

      let classTotalAnnual = 0;
      let classTotalOneTime = 0;

      recurringFees.forEach((c, i) => {
        const name = c.is_optional ? `${c.name} (Optional)` : c.name;
        const nameHeight = doc.heightOfString(name, { width: colWidths[0] - 10 });
        const remarkHeight = doc.heightOfString(c.remarks || '-', { width: colWidths[4] - 10 });
        const rowHeight = Math.max(22, nameHeight + 10, remarkHeight + 10);

        if (doc.y + rowHeight > 750) {
          doc.addPage();
          drawHeader();
          doc.y = 140;
          drawTableHeaders();
        }

        const rowY = doc.y;
        drawRow(c, i, rowY, rowHeight);
        doc.y = rowY + rowHeight; // FIX: Explicit set doc.y

        // Total Calc
        if (!c.is_optional) {
          let m = 1;
          if (c.frequency === 'monthly') m = 12;
          else if (c.frequency === 'quarterly') m = 4;
          else if (c.frequency === 'half_yearly') m = 2;
          else if (c.frequency === 'annual') m = 1; // FIX: "annual" per migration
          classTotalAnnual += (parseFloat(c.amount) * m);
        }
      });

      // Recurring Total Row
      const summaryY = doc.y; // FIX: save summaryY
      doc.fillColor('#f1f5f9').rect(startX, summaryY, 515, 25).fill();
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10);
      doc.text('TOTAL ESTIMATED ANNUAL FEE (Non-Optional)', startX + 5, summaryY + 8);
      doc.text(formatINR(classTotalAnnual), startX + 280, summaryY + 8, { width: colWidths[2] - 10, align: 'right' });
      doc.strokeColor('#1e40af').lineWidth(1).rect(startX, summaryY, 515, 25).stroke();
      doc.y = summaryY + 40;

      // One-Time Fees Table
      if (oneTimeFees.length > 0) {
        if (doc.y > 620) { doc.addPage(); drawHeader(); doc.y = 140; }
        doc.fillColor('#1e40af').font('Helvetica-Bold').fontSize(10).text('One-Time Fees', 40, doc.y);
        doc.moveDown(0.5);
        drawTableHeaders();

        oneTimeFees.forEach((c, i) => {
          const name = c.is_optional ? `${c.name} (Optional)` : c.name;
          const nameHeight = doc.heightOfString(name, { width: colWidths[0] - 10 });
          const remarkHeight = doc.heightOfString(c.remarks || '-', { width: colWidths[4] - 10 });
          const rowHeight = Math.max(22, nameHeight + 10, remarkHeight + 10);

          if (doc.y + rowHeight > 750) {
            doc.addPage();
            drawHeader();
            doc.y = 140;
            drawTableHeaders();
          }

          const rowY = doc.y;
          drawRow(c, i, rowY, rowHeight);
          doc.y = rowY + rowHeight;

          if (!c.is_optional) {
            classTotalOneTime += parseFloat(c.amount);
          }
        });

        const otSummaryY = doc.y;
        doc.fillColor('#f1f5f9').rect(startX, otSummaryY, 515, 25).fill();
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10);
        doc.text('TOTAL ONE-TIME FEES (Non-Optional)', startX + 5, otSummaryY + 8);
        doc.text(formatINR(classTotalOneTime), startX + 280, otSummaryY + 8, { width: colWidths[2] - 10, align: 'right' });
        doc.strokeColor('#1e40af').lineWidth(1).rect(startX, otSummaryY, 515, 25).stroke();
        doc.y = otSummaryY + 45;
      } else {
        doc.y += 5;
      }

      classSummaries.push({
        name: className,
        recurring: classTotalAnnual,
        oneTime: classTotalOneTime,
        grand: classTotalAnnual + classTotalOneTime
      });
    });

    // 4. Cross-class summary table
    if (Object.keys(classGroups).length > 1) {
      doc.addPage();
      drawHeader();
      doc.y = 140;

      doc.fillColor('#1e40af').font('Helvetica-Bold').fontSize(12).text('Fee Summary — All Classes', 40, doc.y);
      doc.moveDown(1);

      const summaryCols = [155, 120, 120, 120];
      const summaryHeaders = ['Class Name', 'Recurring Annual', 'One-Time Total', 'Grand Total'];
      
      doc.fillColor('#dbeafe').rect(startX, doc.y, 515, 22).fill();
      doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(9);
      let curX = startX;
      summaryHeaders.forEach((h, i) => {
        doc.text(h, curX + 5, doc.y + 7, { width: summaryCols[i] - 10, align: i > 0 ? 'right' : 'left' });
        curX += summaryCols[i];
      });
      doc.y += 22;

      let grandTotalRecurring = 0;
      let grandTotalOneTime = 0;

      classSummaries.forEach((s, i) => {
        const rowY = doc.y;
        if (i % 2 === 1) doc.fillColor('#f8fafc').rect(startX, rowY, 515, 22).fill();
        
        doc.fillColor('#1e293b').font('Helvetica').fontSize(9);
        let rx = startX;
        doc.text(s.name, rx + 5, rowY + 7); rx += summaryCols[0];
        doc.text(formatINR(s.recurring), rx + 5, rowY + 7, { width: summaryCols[1] - 10, align: 'right' }); rx += summaryCols[1];
        doc.text(formatINR(s.oneTime), rx + 5, rowY + 7, { width: summaryCols[2] - 10, align: 'right' }); rx += summaryCols[2];
        doc.font('Helvetica-Bold').text(formatINR(s.grand), rx + 5, rowY + 7, { width: summaryCols[3] - 10, align: 'right' });
        
        doc.strokeColor('#e2e8f0').lineWidth(0.5).rect(startX, rowY, 515, 22).stroke();
        doc.y += 22;

        grandTotalRecurring += s.recurring;
        grandTotalOneTime += s.oneTime;
      });

      const finalY = doc.y;
      doc.fillColor('#1e40af').rect(startX, finalY, 515, 25).fill();
      doc.fillColor('white').font('Helvetica-Bold').fontSize(10);
      doc.text('TOTAL SYSTEM FEES', startX + 5, finalY + 8, { width: summaryCols[0] - 10 });
      doc.text(formatINR(grandTotalRecurring), startX + summaryCols[0] + 5, finalY + 8, { width: summaryCols[1] - 10, align: 'right' });
      doc.text(formatINR(grandTotalOneTime), startX + summaryCols[0] + summaryCols[1] + 5, finalY + 8, { width: summaryCols[2] - 10, align: 'right' });
      doc.text(formatINR(grandTotalRecurring + grandTotalOneTime), startX + summaryCols[0] + summaryCols[1] + summaryCols[2] + 5, finalY + 8, { width: summaryCols[3] - 10, align: 'right' });
    }

    // 5. Global Footer
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#64748b').fontSize(8).font('Helvetica');
      doc.text(
        'Note: This fee structure is subject to change. Contact administration for queries.',
        startX, 790, { align: 'left', width: 400, lineBreak: false }
      );
      doc.text(`Page ${i + 1} of ${range.count}`, 450, 790, { align: 'right', width: 100, lineBreak: false });
    }

    doc.flushPages();
    doc.end();
  } catch (err) {
    console.error('[PDF Error]', err);
    if (!res.headersSent) {
      next(err);
    } else {
      res.end(); // Stop streaming if headers already sent
    }
  }
};

exports.createStructure = async (req, res, next) => {
  try {
    const { session_id, class_id, name, amount, frequency, due_day } = req.body;

    let session = null;
    if (session_id) {
      const [[selectedSession]] = await sequelize.query(`
        SELECT id
        FROM sessions
        WHERE id = :sessionId AND school_id = :schoolId
        LIMIT 1;
      `, {
        replacements: {
          sessionId: session_id,
          schoolId : req.user.school_id,
        },
      });
      session = selectedSession || null;
    }

    if (!session) {
      const [[currentSession]] = await sequelize.query(`
        SELECT id FROM sessions WHERE school_id = :schoolId AND is_current = true LIMIT 1;
      `, { replacements: { schoolId: req.user.school_id } });
      session = currentSession || null;
    }

    if (!session) return res.fail('No active session found. Activate a session first.');

    const [[classRow]] = await sequelize.query(`
      SELECT id
      FROM classes
      WHERE id = :classId
        AND school_id = :schoolId
        AND is_deleted = false
      LIMIT 1;
    `, {
      replacements: {
        classId: class_id,
        schoolId: req.user.school_id,
      },
    });

    if (!classRow) return res.fail('Selected class was not found for this school.', [], 404);

    const payload = await sequelize.transaction(async (transaction) => {
      const [[structure]] = await sequelize.query(`
        INSERT INTO fee_structures (session_id, class_id, name, amount, frequency, due_day, is_active, created_at, updated_at)
        VALUES (:session_id, :class_id, :name, :amount, :frequency, :due_day, true, NOW(), NOW())
        RETURNING id, session_id, class_id, name, amount, frequency, due_day, is_active;
      `, {
        replacements: { session_id: session.id, class_id, name, amount, frequency, due_day },
        transaction,
      });

      const invoice_sync = await syncStructureInvoicesForClass({ structure, transaction });
      
      await writeAuditLog(sequelize, {
        tableName: 'fee_structures',
        recordId: structure.id,
        changes: { field: 'name', oldValue: null, newValue: name },
        changedBy: req.user.id,
        reason: 'New fee structure created',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent']
      }, transaction);

      return { ...structure, invoice_sync };
    });

    res.ok(payload, 'Fee structure created.', 201);
    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

exports.deleteStructure = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[deleted]] = await sequelize.query(`
      DELETE FROM fee_structures fs
      USING classes c
      WHERE fs.id = :id
        AND c.id = fs.class_id
        AND c.school_id = :schoolId
      RETURNING fs.id;
    `, {
      replacements: {
        id,
        schoolId: req.user.school_id,
      },
    });

    if (!deleted) return res.fail('Fee structure not found.', [], 404);

    await writeAuditLog(sequelize, {
      tableName: 'fee_structures',
      recordId: id,
      changes: { field: 'is_active', oldValue: 'true', newValue: 'deleted' },
      changedBy: req.user.id,
      reason: 'Fee structure deleted',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    res.ok({ id }, 'Fee structure deleted.');
    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

exports.generate = async (req, res, next) => {
  try {
    const result = await feeManager.generateInvoices(req.body.session_id);

    await writeAuditLog(sequelize, {
      tableName: 'fee_invoices',
      recordId: req.body.session_id,
      changes: { field: 'bulk_generation', oldValue: 'none', newValue: `${result.invoicesCreated} invoices` },
      changedBy: req.user.id,
      reason: 'Bulk invoice generation for session',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    res.ok(result, `${result.invoicesCreated} invoice(s) generated.`);
    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

exports.getStudentFees = async (req, res, next) => {
  try {
    const { enrollment_id } = req.params;

    const [invoices] = await sequelize.query(`
      SELECT fi.id, fs.name AS fee_name, fs.frequency AS fee_frequency, fi.amount_due, fi.amount_paid,
             fi.late_fee_amount, fi.concession_amount,
             (fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid) AS balance,
             fi.due_date, fi.paid_date, fi.status,
             fi.carry_from_invoice_id
      FROM fee_invoices fi
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE fi.enrollment_id = :enrollment_id
      ORDER BY fi.due_date ASC;
    `, { replacements: { enrollment_id } });

    const summary = {
      total_invoices : invoices.length,
      total_due      : invoices.reduce((s, i) => s + parseFloat(i.amount_due), 0).toFixed(2),
      total_paid     : invoices.reduce((s, i) => s + parseFloat(i.amount_paid), 0).toFixed(2),
      total_balance  : invoices.reduce((s, i) => s + parseFloat(i.balance), 0).toFixed(2),
      pending_count  : invoices.filter(i => i.status === 'pending').length,
    };

    res.ok({ invoices, summary }, 'Fee details retrieved.');
  } catch (err) { next(err); }
};

exports.recordPayment = async (req, res, next) => {
  try {
    const { invoice_id, amount, payment_date, payment_mode, transaction_ref } = req.body;

    const result = await feeManager.applyPayment(invoice_id, {
      amount,
      paymentDate    : payment_date,
      paymentMode    : payment_mode,
      transactionRef : transaction_ref || null,
      receivedBy     : req.user.id,
    });

    await writeAuditLog(sequelize, {
      tableName: 'fee_invoices',
      recordId: invoice_id,
      changes: { field: 'amount_paid', oldValue: String(Number(result.oldPaid)), newValue: String(Number(result.newPaid)) },
      changedBy: req.user.id,
      reason: `Payment recorded: ${payment_mode}${transaction_ref ? ` (${transaction_ref})` : ''}`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    res.ok(result, `Payment of Rs.${result.amountApplied} applied. Status: ${result.newStatus}.`, 201);
    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

exports.carryForward = async (req, res, next) => {
  try {
    const { student_id, from_session_id, to_session_id } = req.body;
    const result = await feeManager.carryForwardFees(student_id, from_session_id, to_session_id);

    await writeAuditLog(sequelize, {
      tableName: 'fee_invoices',
      recordId: student_id,
      changes: { field: 'carry_forward', oldValue: `from:${from_session_id}`, newValue: `to:${to_session_id}` },
      changedBy: req.user.id,
      reason: `Carried forward ${result.invoicesCarried} invoices (Total: Rs.${result.totalAmountCarried})`,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });

    res.ok(result, `${result.invoicesCarried} invoice(s) carried forward. Total: Rs.${result.totalAmountCarried}.`);
    invalidateCache(req.user.school_id, '/api/fees*');
    invalidateCache(req.user.school_id, '/api/dashboard*');
  } catch (err) { next(err); }
};

// GET /api/fees/report - Fee collection report
exports.getReport = async (req, res, next) => {
  try {
    const { session_id, class_id } = req.query;

    if (!session_id) return res.fail('session_id is required.');

    // Get summary stats
    const [[summary]] = await sequelize.query(`
      SELECT
        COUNT(DISTINCT fi.enrollment_id) AS total_students,
        COALESCE(SUM(fi.amount_due), 0) AS total_expected,
        COALESCE(SUM(fi.amount_paid), 0) AS total_collected,
        COALESCE(SUM(fi.amount_due - fi.amount_paid), 0) AS total_pending,
        COUNT(CASE WHEN fi.status = 'paid' THEN 1 END) AS paid_count,
        COUNT(CASE WHEN fi.status = 'partial' THEN 1 END) AS partial_count,
        COUNT(CASE WHEN fi.status = 'pending' THEN 1 END) AS pending_count
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId AND e.status = 'active' AND s.school_id = :schoolId
      ${class_id ? 'AND e.class_id = :classId' : ''}
    `, { replacements: { sessionId: session_id, schoolId: req.user.school_id, classId: class_id } });

    // Get student-wise data
    const [students] = await sequelize.query(`
      SELECT
        s.id AS student_id,
        s.first_name || ' ' || s.last_name AS student_name,
        s.admission_no,
        c.name AS class_name,
        COALESCE(SUM(fi.amount_due), 0) AS total_due,
        COALESCE(SUM(fi.amount_paid), 0) AS total_paid,
        COALESCE(SUM(fi.amount_due - fi.amount_paid), 0) AS balance
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.session_id = :sessionId AND e.status = 'active'
      LEFT JOIN fee_invoices fi ON fi.enrollment_id = e.id
      JOIN classes c ON c.id = e.class_id
      WHERE s.school_id = :schoolId
      ${class_id ? 'AND e.class_id = :classId' : ''}
      GROUP BY s.id, s.first_name, s.last_name, s.admission_no, c.name
      ORDER BY c.name, s.first_name
    `, { replacements: { sessionId: session_id, schoolId: req.user.school_id, classId: class_id } });

    res.ok({
      summary: {
        total_expected: summary.total_expected,
        total_collected: summary.total_collected,
        total_pending: summary.total_pending,
        paid_count: parseInt(summary.paid_count),
      },
      students,
    });
  } catch (err) { next(err); }
};

exports.getDashboard = async (req, res, next) => {
  try {
    const sessionId = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!sessionId) return res.fail('No active session found.', [], 404);

    const [[summary]] = await sequelize.query(`
      SELECT
        COUNT(fi.id)::int AS total_invoices,
        COUNT(*) FILTER (WHERE fi.status = 'paid')::int AS paid_invoices,
        COUNT(*) FILTER (WHERE fi.status = 'partial')::int AS partial_invoices,
        COUNT(*) FILTER (WHERE fi.status = 'pending')::int AS pending_invoices,
        COUNT(*) FILTER (
          WHERE fi.status IN ('pending', 'partial')
            AND fi.due_date < CURRENT_DATE
        )::int AS overdue_invoices,
        COALESCE(SUM(fi.amount_due), 0) AS total_expected,
        COALESCE(SUM(fi.amount_paid), 0) AS total_collected,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS total_balance
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId;
    `, {
      replacements: {
        sessionId,
        schoolId: req.user.school_id,
      },
    });

    const [recentPayments] = await sequelize.query(`
      SELECT
        fp.id,
        fp.amount,
        fp.payment_date,
        fp.payment_mode,
        COALESCE(NULLIF(fp.transaction_ref, ''), CONCAT('RCPT-', fp.id)) AS receipt_no,
        fs.name AS fee_name,
        fi.id AS invoice_id,
        s.id AS student_id,
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
      ORDER BY fp.payment_date DESC, fp.id DESC
      LIMIT 8;
    `, {
      replacements: {
        sessionId,
        schoolId: req.user.school_id,
      },
    });

    const [defaulters] = await sequelize.query(`
      SELECT
        s.id AS student_id,
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        COUNT(fi.id)::int AS open_invoices,
        MAX(fi.due_date) AS last_due_date,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS balance
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
        AND fi.due_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
      GROUP BY s.id, s.admission_no, s.first_name, s.last_name, c.name
      ORDER BY balance DESC, last_due_date ASC
      LIMIT 8;
    `, {
      replacements: {
        sessionId,
        schoolId: req.user.school_id,
      },
    });

    res.ok({
      session_id: sessionId,
      summary: {
        ...summary,
        collection_rate: Number(summary?.total_expected || 0) > 0
          ? Number(((Number(summary.total_collected) / Number(summary.total_expected)) * 100).toFixed(2))
          : 0,
      },
      recent_payments: recentPayments,
      defaulters,
    }, 'Accountant dashboard loaded.');
  } catch (err) { next(err); }
};

exports.getInvoices = async (req, res, next) => {
  try {
    const sessionId = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!sessionId) return res.fail('No active session found.', [], 404);

    const {
      class_id,
      status,
      search = '',
      page = 1,
      perPage = 20,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(perPage, 10) || 20, 1);
    const offset = (pageNum - 1) * limitNum;

    const replacements = {
      sessionId,
      schoolId: req.user.school_id,
      classId: class_id || null,
      status: status || null,
      search: `%${search}%`,
      limit: limitNum,
      offset,
    };

    const whereClause = `
      e.session_id = :sessionId
      AND s.school_id = :schoolId
      AND (:classId IS NULL OR e.class_id = CAST(:classId AS INTEGER))
      AND (:status IS NULL OR fi.status = :status)
      AND (
        :search = '%%'
        OR s.admission_no ILIKE :search
        OR CONCAT(s.first_name, ' ', s.last_name) ILIKE :search
        OR fs.name ILIKE :search
      )
    `;

    const [[metaRow]] = await sequelize.query(`
      SELECT COUNT(fi.id)::int AS total
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE ${whereClause};
    `, { replacements });

    const [invoices] = await sequelize.query(`
      SELECT
        fi.id,
        fi.due_date,
        fi.amount_due,
        fi.amount_paid,
        fi.late_fee_amount,
        fi.concession_amount,
        fi.status,
        fi.carry_from_invoice_id,
        fs.name AS fee_name,
        s.id AS student_id,
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        sec.name AS section_name,
        COALESCE(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid, 0) AS balance
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      WHERE ${whereClause}
      ORDER BY fi.due_date ASC, fi.id DESC
      LIMIT :limit OFFSET :offset;
    `, { replacements });

    res.ok({
      invoices,
      meta: {
        page: pageNum,
        perPage: limitNum,
        total: metaRow.total,
        totalPages: Math.max(Math.ceil(metaRow.total / limitNum), 1),
      },
    }, 'Invoices loaded.');
  } catch (err) { next(err); }
};

exports.getReceipts = async (req, res, next) => {
  try {
    const sessionId = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!sessionId) return res.fail('No active session found.', [], 404);

    const {
      class_id,
      payment_mode,
      search = '',
      from,
      to,
      page = 1,
      perPage = 20,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(perPage, 10) || 20, 1);
    const offset = (pageNum - 1) * limitNum;

    const replacements = {
      sessionId,
      schoolId: req.user.school_id,
      classId: class_id || null,
      paymentMode: payment_mode || null,
      search: `%${search}%`,
      from: from || null,
      to: to || null,
      limit: limitNum,
      offset,
    };

    const whereClause = `
      e.session_id = :sessionId
      AND s.school_id = :schoolId
      AND (:classId IS NULL OR e.class_id = CAST(:classId AS INTEGER))
      AND (:paymentMode IS NULL OR fp.payment_mode = :paymentMode)
      AND (:from IS NULL OR fp.payment_date >= CAST(:from AS DATE))
      AND (:to IS NULL OR fp.payment_date <= CAST(:to AS DATE))
      AND (
        :search = '%%'
        OR s.admission_no ILIKE :search
        OR CONCAT(s.first_name, ' ', s.last_name) ILIKE :search
        OR COALESCE(fp.transaction_ref, '') ILIKE :search
        OR fs.name ILIKE :search
      )
    `;

    const [[metaRow]] = await sequelize.query(`
      SELECT 
        COUNT(fp.id)::int AS total,
        COALESCE(SUM(fp.amount), 0) AS total_amount
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      WHERE ${whereClause};
    `, { replacements });

    const [receipts] = await sequelize.query(`
      SELECT
        fp.id,
        fp.amount,
        fp.payment_date,
        fp.payment_mode,
        COALESCE(NULLIF(fp.transaction_ref, ''), CONCAT('RCPT-', fp.id)) AS receipt_no,
        fi.id AS invoice_id,
        fi.due_date,
        fs.name AS fee_name,
        s.id AS student_id,
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        sec.name AS section_name,
        u.name AS received_by_name
      FROM fee_payments fp
      JOIN fee_invoices fi ON fi.id = fp.invoice_id
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN users u ON u.id = fp.received_by
      WHERE ${whereClause}
      ORDER BY fp.payment_date DESC, fp.id DESC
      LIMIT :limit OFFSET :offset;
    `, { replacements });

    res.ok({
      receipts,
      meta: {
        page: pageNum,
        perPage: limitNum,
        total: metaRow.total,
        totalAmount: metaRow.total_amount,
        totalPages: Math.max(Math.ceil(metaRow.total / limitNum), 1),
      },
    }, 'Receipts loaded.');
  } catch (err) { next(err); }
};

exports.getDefaulters = async (req, res, next) => {
  try {
    const sessionId = await resolveSessionId(req.query.session_id, req.user.school_id, true);
    if (!sessionId) return res.fail('No active session found.', [], 404);

    const {
      class_id,
      search = '',
    } = req.query;

    const replacements = {
      sessionId,
      schoolId: req.user.school_id,
      classId: class_id || null,
      search: `%${search}%`,
    };

    const [defaulters] = await sequelize.query(`
      SELECT
        s.id AS student_id,
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        e.class_id AS class_id,
        sec.name AS section_name,
        COUNT(fi.id)::int AS open_invoices,
        MIN(fi.due_date) AS first_due_date,
        MAX(fi.due_date) AS last_due_date,
        COUNT(*) FILTER (
          WHERE fi.due_date < CURRENT_DATE
            AND fi.status IN ('pending', 'partial')
        )::int AS overdue_invoices,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS balance
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
        AND fi.due_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
        AND (:classId IS NULL OR e.class_id = CAST(:classId AS INTEGER))
        AND (
          :search = '%%'
          OR s.admission_no ILIKE :search
          OR CONCAT(s.first_name, ' ', s.last_name) ILIKE :search
        )
      GROUP BY s.id, s.admission_no, s.first_name, s.last_name, c.name, e.class_id, sec.name
      HAVING COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) > 0
      ORDER BY balance DESC, first_due_date ASC;
    `, { replacements });

    res.ok({ defaulters }, 'Defaulters loaded.');
  } catch (err) { next(err); }
};

exports.downloadDefaultersPdf = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const sessionId = await resolveSessionId(req.query.session_id, schoolId, true);
    const { class_id } = req.query;

    const school = await sequelize.query(`SELECT name, address, phone FROM schools WHERE id = :schoolId LIMIT 1`, {
      replacements: { schoolId },
      type: sequelize.QueryTypes.SELECT
    }).then(r => r[0]);

    const session = await sequelize.query(`SELECT name FROM sessions WHERE id = :sessionId LIMIT 1`, {
      replacements: { sessionId },
      type: sequelize.QueryTypes.SELECT
    }).then(r => r[0]);

    const [defaulters] = await sequelize.query(`
      SELECT
        s.admission_no,
        s.first_name || ' ' || s.last_name AS student_name,
        c.name AS class_name,
        sec.name AS section_name,
        COUNT(fi.id)::int AS open_invoices,
        COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) AS balance,
        (SELECT MAX(fp.payment_date) FROM fee_payments fp JOIN fee_invoices fi2 ON fi2.id = fp.invoice_id WHERE fi2.enrollment_id = e.id) AS last_payment_date
      FROM fee_invoices fi
      JOIN enrollments e ON e.id = fi.enrollment_id
      JOIN students s ON s.id = e.student_id
      LEFT JOIN classes c ON c.id = e.class_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      WHERE e.session_id = :sessionId
        AND s.school_id = :schoolId
        AND fi.status IN ('pending', 'partial')
        AND fi.due_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
        AND (:classId IS NULL OR e.class_id = CAST(:classId AS INTEGER))
      GROUP BY s.id, s.admission_no, s.first_name, s.last_name, c.name, sec.name, e.id
      HAVING COALESCE(SUM(fi.amount_due + fi.late_fee_amount - fi.concession_amount - fi.amount_paid), 0) > 0
      ORDER BY c.name ASC, sec.name ASC, balance DESC;
    `, { replacements: { sessionId, schoolId, classId: class_id || null } });

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Defaulters_List_${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // --- Header ---
    const drawHeader = () => {
      doc.fillColor('#0f766e').fontSize(18).font('Helvetica-Bold').text(school?.name ? school.name.toUpperCase() : 'SCHOOL ERP', { align: 'center' });
      doc.fillColor('#64748b').fontSize(9).font('Helvetica').text(school?.address || '', { align: 'center' });
      doc.moveDown(0.5);
      doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('FEE DEFAULTERS LIST', { align: 'center' });
      doc.fontSize(10).text(`Session: ${session?.name || 'Current'}`, { align: 'center' });
      doc.moveDown(1);
      doc.strokeColor('#0f766e').lineWidth(2).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(1.2);
    };

    drawHeader();

    // --- Table Configuration ---
    const startX = 40;
    const cols = [
      { label: 'Adm No', width: 90 },
      { label: 'Student Name', width: 165 },
      { label: 'Class', width: 80 },
      { label: 'Pending Amt', width: 90, align: 'right' },
      { label: 'Last Payment', width: 90, align: 'right' }
    ];

    const drawTableHeader = () => {
      const headerY = doc.y;
      const headerHeight = 22;
      
      // Header background
      doc.fillColor('#0f766e').rect(startX, headerY - 4, 515, headerHeight).fill();
      
      doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
      let currX = startX;
      cols.forEach(c => {
        doc.text(c.label, currX + 5, headerY, { width: c.width - 10, align: c.align || 'left' });
        currX += c.width;
      });
      
      doc.y = headerY + headerHeight;
    };

    drawTableHeader();

    // Data Rows
    let totalPending = 0;

    defaulters.forEach((row, i) => {
      if (doc.y > 720) {
        doc.addPage();
        drawHeader();
        drawTableHeader();
      }

      const rowHeight = 22;
      const rowY = doc.y;

      // Zebra striping
      if (i % 2 === 1) {
        doc.fillColor('#f8fafc').rect(startX, rowY - 4, 515, rowHeight).fill();
      }

      doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
      let currX = startX;
      const classText = `${row.class_name}${row.section_name ? ` (${row.section_name})` : ''}`;
      const lastPay = row.last_payment_date ? new Date(row.last_payment_date).toLocaleDateString('en-IN') : 'None';
      
      doc.text(row.admission_no, currX + 5, rowY, { width: cols[0].width - 10 }); currX += cols[0].width;
      doc.text(row.student_name, currX + 5, rowY, { width: cols[1].width - 10 }); currX += cols[1].width;
      doc.text(classText, currX + 5, rowY, { width: cols[2].width - 10 }); currX += cols[2].width;
      doc.text(formatINR(row.balance), currX + 5, rowY, { width: cols[3].width - 10, align: 'right' }); currX += cols[3].width;
      doc.text(lastPay, currX + 5, rowY, { width: cols[4].width - 10, align: 'right' });

      totalPending += parseFloat(row.balance);
      doc.y = rowY + rowHeight;
      doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(startX, doc.y - 4).lineTo(555, doc.y - 4).stroke();
    });

    // Summary
    if (doc.y > 720) {
      doc.addPage();
      drawHeader();
    }
    doc.moveDown(1);
    doc.fillColor('#0f766e').font('Helvetica-Bold').fontSize(11);
    doc.text(`TOTAL OUTSTANDING: INR ${formatINR(totalPending)}`, { align: 'right' });

    // Footer with page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#94a3b8').fontSize(8).font('Helvetica');
      doc.text(
        `Page ${i + 1} of ${range.count} | Generated on ${new Date().toLocaleString()}`,
        40, 780, { align: 'center', width: 515, lineBreak: false }
      );
    }

    doc.flushPages();
    doc.end();
  } catch (err) { next(err); }
};
