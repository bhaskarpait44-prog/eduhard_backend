'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Certificate = sequelize.define('Certificate', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  certificate_no: {
    type: DataTypes.STRING,
    unique: true,
  },
  school_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('transfer', 'bonafide', 'character', 'migration', 'marksheet', 'sports', 'study', 'experience'),
    allowNull: false,
  },
  recipient_type: {
    type: DataTypes.ENUM('student', 'staff'),
    defaultValue: 'student',
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  teacher_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  issued_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  issued_date: {
    type: DataTypes.DATEONLY,
    defaultValue: DataTypes.NOW,
  },
  extra_data: {
    type: DataTypes.JSON,
  },
  status: {
    type: DataTypes.ENUM('active', 'revoked'),
    defaultValue: 'active',
  },
  pdf_path: {
    type: DataTypes.STRING,
  },
}, {
  tableName: 'certificates',
  timestamps: true,
});

module.exports = Certificate;
