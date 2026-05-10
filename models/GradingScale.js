'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GradingScale = sequelize.define('GradingScale', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(100), allowNull: false },
  is_default: { type: DataTypes.BOOLEAN, defaultValue: false },
  definition: { type: DataTypes.JSONB, allowNull: false }, // Array of { min: 90, grade: 'A+', point: 4.0, remark: 'Excellent' }
  created_by: { type: DataTypes.INTEGER, allowNull: true },
  updated_by: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'grading_scales', underscored: true });

module.exports = GradingScale;
