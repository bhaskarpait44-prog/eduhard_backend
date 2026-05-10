'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudyMaterial = sequelize.define('StudyMaterial', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  class_id: { type: DataTypes.INTEGER, allowNull: false },
  subject_id: { type: DataTypes.INTEGER, allowNull: false },
  teacher_id: { type: DataTypes.INTEGER, allowNull: false },
  session_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  file_path: { type: DataTypes.STRING(500), allowNull: false },
  file_type: { type: DataTypes.STRING(100), allowNull: false },
  file_size: { type: DataTypes.BIGINT, allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'study_materials',
  underscored: true,
});

module.exports = StudyMaterial;
