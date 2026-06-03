'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const School = sequelize.define('School', {
  id          : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name        : { type: DataTypes.STRING(150), allowNull: false },
  branch_name : { type: DataTypes.STRING(100), allowNull: true },
  address     : { type: DataTypes.TEXT, allowNull: true },
  phone       : { type: DataTypes.STRING(20), allowNull: true },
  email       : { type: DataTypes.STRING(150), allowNull: true, validate: { isEmail: true } },
  logo_url    : { type: DataTypes.STRING(500), allowNull: true },
  principal_name: { type: DataTypes.STRING(150), allowNull: true },
  online_admission_open: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  is_active   : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName  : 'schools',
  underscored: true,
});

module.exports = School;