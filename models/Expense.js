'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Expense = sequelize.define('Expense', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  category: { type: DataTypes.ENUM('salary', 'maintenance', 'utilities', 'supplies', 'events', 'misc'), allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  payment_mode: { type: DataTypes.STRING(50), allowNull: true },
  status: { type: DataTypes.ENUM('submitted', 'approved', 'paid', 'rejected'), allowNull: false, defaultValue: 'submitted' },
  submitted_by: { type: DataTypes.INTEGER, allowNull: true },
  approved_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'expenses',
  underscored: true,
});

module.exports = Expense;
