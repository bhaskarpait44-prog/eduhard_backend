'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Teacher = sequelize.define('Teacher', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  first_name: { type: DataTypes.STRING(100), allowNull: false },
  last_name: { type: DataTypes.STRING(100), allowNull: false },
  email: { type: DataTypes.STRING(150), allowNull: false },
  phone: { type: DataTypes.STRING(20), allowNull: true },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  profile_photo: { type: DataTypes.STRING(500), allowNull: true },
  date_of_birth: { type: DataTypes.DATEONLY, allowNull: true },
  gender: { type: DataTypes.ENUM('male', 'female', 'other'), allowNull: true },
  address: { type: DataTypes.TEXT, allowNull: true },
  employee_id: { type: DataTypes.STRING(50), allowNull: true },
  department: { type: DataTypes.STRING(100), allowNull: true },
  designation: { type: DataTypes.STRING(100), allowNull: true },
  joining_date: { type: DataTypes.DATEONLY, allowNull: true },
  highest_qualification: { type: DataTypes.STRING(150), allowNull: true },
  specialization: { type: DataTypes.STRING(150), allowNull: true },
  university_name: { type: DataTypes.STRING(200), allowNull: true },
  graduation_year: { type: DataTypes.INTEGER, allowNull: true },
  years_of_experience: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  force_password_change: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  last_password_change: { type: DataTypes.DATE, allowNull: true },
  last_login_at: { type: DataTypes.DATE, allowNull: true },
  failed_login_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  locked_until: { type: DataTypes.DATE, allowNull: true },
  reset_password_token: { type: DataTypes.STRING(255), allowNull: true },
  reset_password_expires: { type: DataTypes.DATE, allowNull: true },
  is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: 'teachers',
  underscored: true,
  defaultScope: {
    attributes: { exclude: ['password_hash'] },
    where: { is_deleted: false },
  },
  scopes: {
    withPassword: { attributes: {}, where: { is_deleted: false } },
    withDeleted: { where: {} },
  },
});

module.exports = Teacher;
