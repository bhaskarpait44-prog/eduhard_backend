'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentSubject = sequelize.define('StudentSubject', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  session_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  subject_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  is_core: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'student_subjects',
  underscored: true,
  indexes: [
    { unique: true, fields: ['student_id', 'session_id', 'subject_id'] },
    { fields: ['student_id', 'session_id'] },
  ],
});

module.exports = StudentSubject;
