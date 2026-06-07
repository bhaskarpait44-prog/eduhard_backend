'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Student = sequelize.define('Student', {
  id            : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id     : { type: DataTypes.INTEGER, allowNull: false },
  admission_no  : { type: DataTypes.STRING(50), allowNull: false },
  first_name    : { type: DataTypes.STRING(100), allowNull: false },
  last_name     : { type: DataTypes.STRING(100), allowNull: false },
  date_of_birth : { type: DataTypes.DATEONLY, allowNull: false },
  gender                 : { type: DataTypes.ENUM('male', 'female', 'other'), allowNull: false },
  aadhar_no              : { type: DataTypes.STRING(20), allowNull: true },
  family_id              : { type: DataTypes.INTEGER, allowNull: true },
  transport_stop_id      : { type: DataTypes.INTEGER, allowNull: true },
  is_deleted             : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  password_hash          : { type: DataTypes.STRING(255), allowNull: true },
  is_active              : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  status                 : { type: DataTypes.ENUM('active', 'left', 'graduated'), allowNull: false, defaultValue: 'active' },
  left_date              : { type: DataTypes.DATEONLY, allowNull: true },
  leaving_reason         : { type: DataTypes.STRING(100), allowNull: true },
  leaving_remarks        : { type: DataTypes.TEXT, allowNull: true },
  last_login_at          : { type: DataTypes.DATE, allowNull: true },
  failed_login_attempts  : { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  locked_until           : { type: DataTypes.DATE, allowNull: true },
  reset_password_token   : { type: DataTypes.STRING(255), allowNull: true },
  reset_password_expires : { type: DataTypes.DATE, allowNull: true },
}, {
  tableName   : 'students',
  underscored : true,
  defaultScope: {
    // Always exclude soft-deleted students unless explicitly requested
    where: { is_deleted: false },
  },
  scopes: {
    withDeleted : {},                          // Student.scope('withDeleted').findAll()
    deletedOnly : { where: { is_deleted: true } },
  },
});

module.exports = Student;