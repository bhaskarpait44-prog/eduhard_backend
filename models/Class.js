'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/database');

const Class = sequelize.define('Class', {
  id           : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id    : { type: DataTypes.INTEGER, allowNull: false },
  name         : { type: DataTypes.STRING(100), allowNull: false },
  display_name : { type: DataTypes.STRING(100), allowNull: true },
  order_number : { type: DataTypes.INTEGER, allowNull: false },
  stream       : { type: DataTypes.STRING(20), allowNull: true },
  min_age      : { type: DataTypes.INTEGER, allowNull: true },
  max_age      : { type: DataTypes.INTEGER, allowNull: true },
  description  : { type: DataTypes.TEXT, allowNull: true },
  is_active    : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  is_deleted   : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  created_by   : { type: DataTypes.INTEGER, allowNull: true },
  updated_by   : { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName   : 'classes',
  underscored : true,
  defaultScope: {
    where: { is_deleted: false },
  },
  scopes: {
    active  : { where: { is_deleted: false, is_active: true } },
    withDeleted: {},
  },
});

module.exports = Class;
