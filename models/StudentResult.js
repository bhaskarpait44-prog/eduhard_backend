'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentResult = sequelize.define('StudentResult', {
  id                        : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  enrollment_id             : { type: DataTypes.INTEGER, allowNull: false, unique: true },
  session_id                : { type: DataTypes.INTEGER, allowNull: false },
  total_marks               : { type: DataTypes.DECIMAL(8, 2), allowNull: false },
  marks_obtained            : { type: DataTypes.DECIMAL(8, 2), allowNull: false },
  percentage                : { type: DataTypes.DECIMAL(5, 2), allowNull: false },
  grade                     : { type: DataTypes.STRING(5), allowNull: false },
  result                    : { type: DataTypes.ENUM('pass', 'fail', 'compartment', 'detained'), allowNull: false },
  compartment_subjects      : { type: DataTypes.JSON, allowNull: true },
  is_promoted               : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  is_locked                 : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  locked_at                 : { type: DataTypes.DATE, allowNull: true },
  locked_by                 : { type: DataTypes.INTEGER, allowNull: true },
  promotion_override_by     : { type: DataTypes.INTEGER, allowNull: true },
  promotion_override_reason : { type: DataTypes.TEXT, allowNull: true },
  release_result            : { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  released_by               : { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'student_results', underscored: true });

module.exports = StudentResult;