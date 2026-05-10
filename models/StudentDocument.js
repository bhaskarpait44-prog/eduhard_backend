// backend/models/StudentDocument.js
'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentDocument = sequelize.define('StudentDocument', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(100), allowNull: false },
  document_type: { type: DataTypes.STRING(50), allowNull: true, defaultValue: 'other' },
  file_path: { type: DataTypes.STRING(255), allowNull: false },
  file_type: { type: DataTypes.STRING(100), allowNull: true },
  file_size: { type: DataTypes.INTEGER, allowNull: true },
  uploaded_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'student_documents',
  underscored: true,
});

module.exports = StudentDocument;
