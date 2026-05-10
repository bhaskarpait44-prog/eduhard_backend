'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Payroll = sequelize.define('Payroll', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  month: { type: DataTypes.INTEGER, allowNull: false },
  year: { type: DataTypes.INTEGER, allowNull: false },
  basic: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  hra: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  da: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  allowances: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  deductions: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  net_salary: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  status: { type: DataTypes.ENUM('generated', 'paid'), allowNull: false, defaultValue: 'generated' },
  payment_date: { type: DataTypes.DATEONLY, allowNull: true },
  payment_mode: { type: DataTypes.STRING(50), allowNull: true },
  remarks: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'payrolls',
  underscored: true,
});

module.exports = Payroll;
