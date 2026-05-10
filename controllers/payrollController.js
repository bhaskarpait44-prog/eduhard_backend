'use strict';

const sequelize = require('../config/database');
const { SalaryStructure, Payroll, User } = require('../models');

// ── Salary Structures ────────────────────────────────────────────────────────

exports.getStructures = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const [staff] = await sequelize.query(`
      SELECT 
        u.id AS user_id, u.name, u.role, u.employee_id, u.designation,
        ss.id AS structure_id, ss.basic, ss.hra, ss.da, ss.allowances, ss.deductions
      FROM users u
      LEFT JOIN salary_structures ss ON ss.user_id = u.id
      WHERE u.school_id = :schoolId
        AND u.is_active = true
        AND u.is_deleted = false
        AND u.role IN ('admin', 'staff', 'librarian', 'receptionist', 'accountant', 'teacher')
      ORDER BY u.name ASC;
    `, { replacements: { schoolId } });

    res.ok(staff);
  } catch (err) { next(err); }
};

exports.updateStructure = async (req, res, next) => {
  try {
    const { user_id } = req.params;
    const { basic, hra, da, allowances, deductions } = req.body;
    const schoolId = req.user.school_id;

    let structure = await SalaryStructure.findOne({ where: { user_id, school_id: schoolId } });
    
    if (structure) {
      structure = await structure.update({
        basic: basic || 0,
        hra: hra || 0,
        da: da || 0,
        allowances: allowances || 0,
        deductions: deductions || 0
      });
    } else {
      structure = await SalaryStructure.create({
        school_id: schoolId,
        user_id,
        basic: basic || 0,
        hra: hra || 0,
        da: da || 0,
        allowances: allowances || 0,
        deductions: deductions || 0
      });
    }

    res.ok(structure, 'Salary structure updated successfully.');
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
        u.id AS user_id, u.name, u.employee_id, u.role, u.designation
      FROM payrolls p
      JOIN users u ON u.id = p.user_id
      WHERE p.school_id = :schoolId AND p.month = :month AND p.year = :year
      ORDER BY u.name ASC;
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
      SELECT user_id, basic, hra, da, allowances, deductions
      FROM salary_structures
      WHERE school_id = :schoolId;
    `, { replacements: { schoolId }, transaction });

    if (structures.length === 0) {
      await transaction.rollback();
      return res.fail('No salary structures defined. Please define them first.', [], 400);
    }

    let generated = 0;

    for (const struct of structures) {
      const net_salary = Number(struct.basic) + Number(struct.hra) + Number(struct.da) + Number(struct.allowances) - Number(struct.deductions);
      
      await sequelize.query(`
        INSERT INTO payrolls (school_id, user_id, month, year, basic, hra, da, allowances, deductions, net_salary, status, created_at, updated_at)
        VALUES (:schoolId, :userId, :month, :year, :basic, :hra, :da, :allowances, :deductions, :net_salary, 'generated', NOW(), NOW())
        ON CONFLICT (user_id, month, year) DO UPDATE SET
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
          userId: struct.user_id, 
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
  try {
    const { id } = req.params;
    const { payment_mode, payment_date, remarks } = req.body;
    const schoolId = req.user.school_id;

    const [[updated]] = await sequelize.query(`
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
      } 
    });

    if (!updated) return res.fail('Payroll record not found or already paid.', [], 404);

    res.ok(updated, 'Salary marked as paid.');
  } catch (err) { next(err); }
};

exports.getPayslip = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [[payslip]] = await sequelize.query(`
      SELECT 
        p.*, 
        u.name, u.employee_id, u.designation, u.department,
        sch.name AS school_name, sch.address AS school_address, sch.logo_url
      FROM payrolls p
      JOIN users u ON u.id = p.user_id
      JOIN schools sch ON sch.id = p.school_id
      WHERE p.id = :id AND p.school_id = :schoolId
      LIMIT 1;
    `, { replacements: { id, schoolId } });

    if (!payslip) return res.fail('Payslip not found', [], 404);

    res.ok(payslip);
  } catch (err) { next(err); }
};
