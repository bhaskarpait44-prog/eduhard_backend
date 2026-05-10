'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const InventoryTransaction = sequelize.define('InventoryTransaction', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  item_id: { type: DataTypes.INTEGER, allowNull: false },
  type: { type: DataTypes.ENUM('in', 'out'), allowNull: false },
  quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  remarks: { type: DataTypes.TEXT, allowNull: true },
  performed_by: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'inventory_transactions', underscored: true });

module.exports = InventoryTransaction;
