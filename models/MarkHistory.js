'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MarkHistory = sequelize.define('MarkHistory', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  exam_id: { type: DataTypes.INTEGER, allowNull: false },
  enrollment_id: { type: DataTypes.INTEGER, allowNull: false },
  subject_id: { type: DataTypes.INTEGER, allowNull: false },
  old_marks_obtained: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  new_marks_obtained: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  old_theory_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  new_theory_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  old_practical_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  new_practical_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  old_is_absent: { type: DataTypes.BOOLEAN, allowNull: true },
  new_is_absent: { type: DataTypes.BOOLEAN, allowNull: true },
  changed_by: { type: DataTypes.INTEGER, allowNull: false },
  change_reason: { type: DataTypes.TEXT, allowNull: true },
  change_type: { type: DataTypes.ENUM('entry', 'override', 'grace'), defaultValue: 'entry' },
}, { tableName: 'mark_histories', underscored: true });

module.exports = MarkHistory;
