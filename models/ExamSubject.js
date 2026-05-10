'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ExamSubject = sequelize.define('ExamSubject', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  exam_id: { type: DataTypes.INTEGER, allowNull: false },
  subject_id: { type: DataTypes.INTEGER, allowNull: false },
  subject_type: { type: DataTypes.ENUM('theory', 'practical', 'both'), allowNull: false, defaultValue: 'theory' },
  theory_total_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  theory_passing_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  practical_total_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  practical_passing_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  combined_total_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
  combined_passing_marks: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
  assigned_teacher_id: { type: DataTypes.INTEGER, allowNull: true },
  exam_date: { type: DataTypes.DATEONLY, allowNull: true },
  start_time: { type: DataTypes.TIME, allowNull: true },
  end_time: { type: DataTypes.TIME, allowNull: true },
  invigilator_teacher_id: { type: DataTypes.INTEGER, allowNull: true },
  review_status: { type: DataTypes.ENUM('draft', 'submitted', 'approved', 'rejected'), allowNull: false, defaultValue: 'draft' },
  submitted_by: { type: DataTypes.INTEGER, allowNull: true },
  submitted_at: { type: DataTypes.DATE, allowNull: true },
  reviewed_by: { type: DataTypes.INTEGER, allowNull: true },
  reviewed_at: { type: DataTypes.DATE, allowNull: true },
  review_note: { type: DataTypes.STRING(500), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
  updated_by: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'exam_subjects', underscored: true });

module.exports = ExamSubject;
