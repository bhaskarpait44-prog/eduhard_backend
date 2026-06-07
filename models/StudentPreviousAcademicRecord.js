'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentPreviousAcademicRecord = sequelize.define('StudentPreviousAcademicRecord', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  school_name: { type: DataTypes.STRING(255), allowNull: false },
  location: { type: DataTypes.STRING(255), allowNull: true },
  class_name: { type: DataTypes.STRING(50), allowNull: false },
  year_of_study: { type: DataTypes.STRING(20), allowNull: true },
  percentage_grade: { type: DataTypes.STRING(50), allowNull: true },
}, {
  tableName: 'student_previous_academic_records',
  underscored: true,
});

module.exports = StudentPreviousAcademicRecord;
