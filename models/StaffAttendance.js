'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StaffAttendance = sequelize.define('StaffAttendance', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  school_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  teacher_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('present', 'absent', 'late', 'half_day', 'leave'),
    allowNull: false,
    defaultValue: 'present',
  },
  remarks: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'staff_attendance',
  underscored: true,
});

module.exports = StaffAttendance;
