'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ExamResult = sequelize.define('ExamResult', {
  id              : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  exam_id         : { type: DataTypes.INTEGER, allowNull: false },
  enrollment_id   : { type: DataTypes.INTEGER, allowNull: false },
  subject_id      : { type: DataTypes.INTEGER, allowNull: false },
  marks_obtained  : { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  theory_marks_obtained    : { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  practical_marks_obtained : { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  is_absent       : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  grade           : { type: DataTypes.STRING(5), allowNull: true },
  is_pass         : { type: DataTypes.BOOLEAN, allowNull: true },
  entered_by      : { type: DataTypes.INTEGER, allowNull: true },
  override_by     : { type: DataTypes.INTEGER, allowNull: true },
  override_reason : { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'exam_results', underscored: true });

module.exports = ExamResult;
