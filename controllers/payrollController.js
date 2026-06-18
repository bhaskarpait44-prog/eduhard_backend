'use strict';

const sequelize = require('../config/database');
const { escapeHtml } = require('../utils/helpers');
const { generatePayslipHtml } = require('../utils/payslipTemplate');
const { renderPdf } = require('../utils/puppeteerPdf');
const { sendEmail } = require('../utils/mailer');

// ── Salary Structures ────────────────────────────────────────────────────────

exports.getStructures = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const [staff] = await sequelize.query(`
      WITH staff_list AS (
        SELECT id, name, role::text, employee_id, designation, department, school_id, is_active, is_deleted, 'user' as type
        FROM users
        WHERE role IN ('admin', 'staff', 'librarian', 'receptionist', 'accountant')
        UNION ALL
        SELECT id, CONCAT(first_name, ' ', last_name) AS name, 'teacher' AS role, employee_id, designation, department, school_id, is_active, is_deleted, 'teacher' as type
        FROM teachers
      )
      SELECT 
        sl.id AS staff_id, sl.name, sl.role, sl.employee_id, sl.designation, sl.type,
        ss.id AS structure_id, ss.basic, ss.hra, ss.da, ss.allowances, ss.deductions
      FROM staff_list sl
      LEFT JOIN salary_structures ss ON (
        (sl.type = 'user' AND ss.user_id = sl.id) OR
        (sl.type = 'teacher' AND ss.teacher_id = sl.id)
      ) AND ss.school_id = sl.school_id
      WHERE sl.school_id = :schoolId
        AND sl.is_active = true
        AND sl.is_deleted = false
      ORDER BY sl.name ASC;
    `, { replacements: { schoolId } });

    res.ok(staff);
  } catch (err) { next(err); }
};

exports.updateStructure = async (req, res, next) => {
  try {
    const { user_id } = req.params; // This is the staff_id
    const { basic, hra, da, allowances, deductions, type } = req.body;
    const schoolId = req.user.school_id;

    if (!type) return res.fail('Staff type is required (user or teacher).');

    const idColumn = type === 'teacher' ? 'teacher_id' : 'user_id';

    const [[existing]] = await sequelize.query(`
      SELECT id FROM salary_structures WHERE ${idColumn} = :user_id AND school_id = :schoolId
    `, { replacements: { user_id, schoolId } });

    let structure;
    if (existing) {
      [structure] = await sequelize.query(`
        UPDATE salary_structures SET
          basic = :basic,
          hra = :hra,
          da = :da,
          allowances = :allowances,
          deductions = :deductions,
          updated_at = NOW()
        WHERE ${idColumn} = :user_id AND school_id = :schoolId
        RETURNING *
      `, { replacements: { 
        user_id, schoolId, 
        basic: basic || 0, 
        hra: hra || 0, 
        da: da || 0, 
        allowances: allowances || 0, 
        deductions: deductions || 0 
      } });
    } else {
      [structure] = await sequelize.query(`
        INSERT INTO salary_structures (
          school_id, ${idColumn}, basic, hra, da, allowances, deductions, created_at, updated_at
        ) VALUES (
          :schoolId, :user_id, :basic, :hra, :da, :allowances, :deductions, NOW(), NOW()
        ) RETURNING *
      `, { replacements: { 
        schoolId, user_id, 
        basic: basic || 0, 
        hra: hra || 0, 
        da: da || 0, 
        allowances: allowances || 0, 
        deductions: deductions || 0 
      } });
    }

    res.ok(structure[0], 'Salary structure updated successfully.');
  } catch (err) { next(err); }
};

// ── Payrolls ─────────────────────────────────────────────────────────────────

exports.getPayrolls = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);

    if (!month || !year) return res.fail('Month and year required.');

    const [payrolls] = await sequelize.query(`
      SELECT 
        p.id, p.month, p.year, p.basic, p.hra, p.da, p.allowances, p.deductions, p.net_salary, p.status, p.payment_date, p.payment_mode,
        COALESCE(u.id, t.id) AS staff_id,
        COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) AS name,
        COALESCE(u.employee_id, t.employee_id) AS employee_id,
        COALESCE(u.role, 'teacher') AS role,
        COALESCE(u.designation, t.designation) AS designation,
        CASE WHEN p.teacher_id IS NOT NULL THEN 'teacher' ELSE 'user' END as type
      FROM payrolls p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN teachers t ON t.id = p.teacher_id
      WHERE p.school_id = :schoolId AND p.month = :month AND p.year = :year
      ORDER BY name ASC;
    `, { replacements: { schoolId, month, year } });

    res.ok(payrolls);
  } catch (err) { next(err); }
};

exports.generatePayroll = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const schoolId = req.user.school_id;
    const month = parseInt(req.body.month, 10);
    const year = parseInt(req.body.year, 10);

    if (!month || !year) throw new Error('Month and year required.');

    const [structures] = await sequelize.query(`
      SELECT 
        ss.user_id, ss.teacher_id, ss.basic, ss.hra, ss.da, ss.allowances, ss.deductions
      FROM salary_structures ss
      LEFT JOIN users u ON u.id = ss.user_id
      LEFT JOIN teachers t ON t.id = ss.teacher_id
      WHERE ss.school_id = :schoolId
        AND (
          (ss.user_id IS NOT NULL AND u.is_active = true AND u.is_deleted = false)
          OR
          (ss.teacher_id IS NOT NULL AND t.is_active = true AND t.is_deleted = false)
        );
    `, { replacements: { schoolId }, transaction });

    if (structures.length === 0) {
      await transaction.rollback();
      return res.fail('No salary structures defined. Please define them first.', [], 400);
    }

    let generated = 0;

    for (const struct of structures) {
      const net_salary = Number(struct.basic) + Number(struct.hra) + Number(struct.da) + Number(struct.allowances) - Number(struct.deductions);
      
      const idColumn = struct.teacher_id ? 'teacher_id' : 'user_id';
      const idValue = struct.teacher_id || struct.user_id;

      await sequelize.query(`
        INSERT INTO payrolls (school_id, ${idColumn}, month, year, basic, hra, da, allowances, deductions, net_salary, status, created_at, updated_at)
        VALUES (:schoolId, :idValue, :month, :year, :basic, :hra, :da, :allowances, :deductions, :net_salary, 'generated', NOW(), NOW())
        ON CONFLICT (${idColumn}, month, year) DO UPDATE SET
          basic = EXCLUDED.basic,
          hra = EXCLUDED.hra,
          da = EXCLUDED.da,
          allowances = EXCLUDED.allowances,
          deductions = EXCLUDED.deductions,
          net_salary = EXCLUDED.net_salary,
          updated_at = NOW()
        WHERE payrolls.status = 'generated';
      `, { 
        replacements: { 
          schoolId, 
          idValue, 
          month, 
          year,
          basic: struct.basic,
          hra: struct.hra,
          da: struct.da,
          allowances: struct.allowances,
          deductions: struct.deductions,
          net_salary
        }, 
        transaction 
      });
      generated++;
    }

    await transaction.commit();
    res.ok(null, `Payroll generated for ${generated} staff members.`, 201);
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
};

exports.markPaid = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { payment_mode, payment_date, remarks } = req.body;
    const schoolId = req.user.school_id;

    // 1. Update payroll status
    const [[result]] = await sequelize.query(`
      UPDATE payrolls
      SET status = 'paid', payment_mode = :payment_mode, payment_date = :payment_date, remarks = :remarks, updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId AND status = 'generated'
      RETURNING *;
    `, { 
      replacements: { 
        id, 
        schoolId, 
        payment_mode: payment_mode || 'Cash', 
        payment_date: payment_date || new Date().toISOString().split('T')[0],
        remarks: remarks || null
      },
      transaction
    });

    if (!result) {
      await transaction.rollback();
      return res.fail('Payroll record not found or already paid.', [], 404);
    }

    // 2. Fetch staff details (including email)
    const [[staff]] = await sequelize.query(`
      SELECT 
        p.*, 
        COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) AS name,
        COALESCE(u.email, t.email) AS email,
        COALESCE(u.employee_id, t.employee_id) AS employee_id,
        COALESCE(u.designation, t.designation) AS designation,
        COALESCE(u.department, t.department) AS department,
        sch.name AS school_name, sch.address AS school_address, sch.logo_url
      FROM payrolls p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN teachers t ON t.id = p.teacher_id
      JOIN schools sch ON sch.id = p.school_id
      WHERE p.id = :id
      LIMIT 1;
    `, { replacements: { id }, transaction });

    // 3. Create expense record
    const monthName = new Date(0, result.month - 1).toLocaleString('default', { month: 'long' });
    const description = `Salary for ${staff.name} (${monthName} ${result.year})`;

    await sequelize.query(`
      INSERT INTO expenses (school_id, category, amount, date, description, payment_mode, status, submitted_by, approved_by, created_at, updated_at)
      VALUES (:schoolId, 'salary', :amount, :date, :description, :payment_mode, 'paid', :userId, :userId, NOW(), NOW())
    `, { 
      replacements: { 
        schoolId, 
        amount: result.net_salary, 
        date: result.payment_date, 
        description, 
        payment_mode: result.payment_mode,
        userId: req.user.id
      },
      transaction
    });

    await transaction.commit();

    // 4. Async background task: Generate PDF and Send Email
    if (staff.email) {
      (async () => {
        try {
          console.log(`[Payroll] Background task started for ${staff.name} (${staff.email})`);
          console.log(`[Payroll] Generating payslip PDF...`);
          const html = generatePayslipHtml(staff);
          const pdfBuffer = await renderPdf(html);
          console.log(`[Payroll] PDF generated successfully. Size: ${pdfBuffer.length} bytes`);

          console.log(`[Payroll] Sending email to ${staff.email}...`);
          const safeStaffName = escapeHtml(staff.name);
          const safeSchoolName = escapeHtml(staff.school_name);
          await sendEmail({
            to: staff.email,
            subject: `Salary Slip - ${monthName} ${staff.year} | ${staff.school_name}`,
            text: `Dear ${staff.name},\n\nYour salary for ${monthName} ${staff.year} has been processed.\n\nPlease find your salary slip attached.\n\nBest Regards,\nAccounts Department\n${staff.school_name}`,
            html: `<p>Dear <b>${safeStaffName}</b>,</p><p>Your salary for <b>${monthName} ${staff.year}</b> has been processed.</p><p>Please find your salary slip attached.</p><br/><p>Best Regards,<br/>Accounts Department<br/>${safeSchoolName}</p>`,
            attachments: [
              {
                filename: `Salary_Slip_${staff.name.replace(/[^a-z0-9]/gi, '_')}_${monthName}_${staff.year}.pdf`,
                content: pdfBuffer,
              }
            ]
          });
          console.log(`[Payroll] Payslip email sent successfully to ${staff.email}`);
        } catch (err) {
          console.error('[Payroll Email/PDF Error]', err);
        }
      })();
    } else {
      console.log(`[Payroll] Skipping email for ${staff.name} - No email found in record.`);
    }

    res.ok(result, 'Salary marked as paid, recorded in expenses, and email slip queued.');
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
};

exports.getPayslip = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[payslip]] = await sequelize.query(`
      SELECT 
        p.*, 
        COALESCE(u.name, CONCAT(t.first_name, ' ', t.last_name)) AS name,
        COALESCE(u.employee_id, t.employee_id) AS employee_id,
        COALESCE(u.designation, t.designation) AS designation,
        COALESCE(u.department, t.department) AS department,
        sch.name AS school_name, sch.address AS school_address, sch.logo_url
      FROM payrolls p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN teachers t ON t.id = p.teacher_id
      JOIN schools sch ON sch.id = p.school_id
      WHERE p.id = :id AND p.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!payslip) return res.fail('Payslip not found', [], 404);

    res.ok(payslip);
  } catch (err) { next(err); }
};
