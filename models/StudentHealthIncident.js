'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentHealthIncident = sequelize.define('StudentHealthIncident', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  incident_date: { type: DataTypes.DATEONLY, allowNull: false },
  incident_time: { type: DataTypes.TIME, allowNull: true },
  type: { type: DataTypes.ENUM('injury', 'illness', 'other'), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  action_taken: { type: DataTypes.TEXT, allowNull: true },
  reported_by: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'student_health_incidents', underscored: true });

module.exports = StudentHealthIncident;
