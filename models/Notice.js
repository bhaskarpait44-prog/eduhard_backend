'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notice = sequelize.define('Notice', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  posted_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
  posted_by_role: { type: DataTypes.ENUM('admin', 'teacher', 'accountant', 'receptionist', 'librarian'), allowNull: false },
  audience: { 
    type: DataTypes.ENUM(
      'school_wide', 'class', 'section', 'student', 
      'teachers', 'parents', 'accountants', 'librarians', 'receptionists', 
      'specific_teacher', 'subject_wise'
    ), 
    allowNull: false 
  },
  is_school_wide: { type: DataTypes.BOOLEAN, defaultValue: false },
  target_class_id: { type: DataTypes.INTEGER, allowNull: true },
  target_section_id: { type: DataTypes.INTEGER, allowNull: true },
  target_student_id: { type: DataTypes.INTEGER, allowNull: true },
  target_teacher_id: { type: DataTypes.INTEGER, allowNull: true },
  target_subject_id: { type: DataTypes.INTEGER, allowNull: true },
  priority: { type: DataTypes.ENUM('normal', 'urgent', 'info'), defaultValue: 'normal' },
  expires_at: { type: DataTypes.DATE, allowNull: true },
  attachment_path: { type: DataTypes.STRING(500), allowNull: true },
  is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { 
  tableName: 'notices', 
  underscored: true 
});

module.exports = Notice;
