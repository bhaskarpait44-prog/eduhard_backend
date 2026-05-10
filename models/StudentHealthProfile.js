'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentHealthProfile = sequelize.define('StudentHealthProfile', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  blood_group: { type: DataTypes.STRING(10), allowNull: true },
  height_cm: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
  weight_kg: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
  allergies: { type: DataTypes.TEXT, allowNull: true },
  medical_conditions: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'student_health_profiles', underscored: true });

module.exports = StudentHealthProfile;
