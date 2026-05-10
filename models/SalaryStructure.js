'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SalaryStructure = sequelize.define('SalaryStructure', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  basic: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  hra: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  da: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  allowances: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  deductions: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
}, {
  tableName: 'salary_structures',
  underscored: true,
});

module.exports = SalaryStructure;
