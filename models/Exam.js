'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Exam = sequelize.define('Exam', {
  id            : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  session_id    : { type: DataTypes.INTEGER, allowNull: false },
  class_id      : { type: DataTypes.INTEGER, allowNull: false },
  name          : { type: DataTypes.STRING(150), allowNull: false },
  exam_type     : { type: DataTypes.ENUM('term', 'midterm', 'final', 'compartment'), allowNull: false },
  start_date    : { type: DataTypes.DATEONLY, allowNull: false },
  end_date      : { type: DataTypes.DATEONLY, allowNull: false },
  total_marks   : { type: DataTypes.DECIMAL(8, 2), allowNull: false },
  passing_marks : { type: DataTypes.DECIMAL(8, 2), allowNull: false },
  weightage     : { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 100.00 },
  publish_controls: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  status        : { type: DataTypes.ENUM('upcoming', 'ongoing', 'completed', 'draft', 'published'), allowNull: false, defaultValue: 'draft' },
  published_at  : { type: DataTypes.DATE, allowNull: true },
  published_by  : { type: DataTypes.INTEGER, allowNull: true },
  created_by    : { type: DataTypes.INTEGER, allowNull: true },
  updated_by    : { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'exams', underscored: true });

module.exports = Exam;
