'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TransportRoute = sequelize.define('TransportRoute', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(150), allowNull: false },
  vehicle_number: { type: DataTypes.STRING(50), allowNull: true },
  driver_name: { type: DataTypes.STRING(150), allowNull: true },
  driver_phone: { type: DataTypes.STRING(20), allowNull: true },
}, { tableName: 'transport_routes', underscored: true });

module.exports = TransportRoute;
