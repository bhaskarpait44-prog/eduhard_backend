'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const InventoryItem = sequelize.define('InventoryItem', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(150), allowNull: false },
  category: { type: DataTypes.STRING(100), allowNull: false },
  unit: { type: DataTypes.STRING(50), allowNull: false },
  quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  reorder_level: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  description: { type: DataTypes.TEXT, allowNull: true },
  location: { type: DataTypes.STRING(150), allowNull: true },
  unit_price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
}, { tableName: 'inventory_items', underscored: true });

module.exports = InventoryItem;
