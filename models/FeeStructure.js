'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FeeStructure = sequelize.define('FeeStructure', {
  id         : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  session_id : { type: DataTypes.INTEGER, allowNull: false },
  class_id   : { type: DataTypes.INTEGER, allowNull: false },
  name       : { type: DataTypes.STRING(150), allowNull: false },
  amount     : { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  frequency  : {
    type      : DataTypes.ENUM('monthly', 'quarterly', 'annual', 'one_time'),
    allowNull : false,
  },
  due_day    : { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
  is_active  : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName   : 'fee_structures',
  underscored : true,
  defaultScope: { where: { is_active: true } },
  scopes      : { all: {} },
});

module.exports = FeeStructure;