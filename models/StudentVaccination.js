'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentVaccination = sequelize.define('StudentVaccination', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  vaccine_name: { type: DataTypes.STRING(150), allowNull: false },
  date_administered: { type: DataTypes.DATEONLY, allowNull: true },
  next_due_date: { type: DataTypes.DATEONLY, allowNull: true },
  remarks: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'student_vaccinations', underscored: true });

module.exports = StudentVaccination;
