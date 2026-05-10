'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TransportStop = sequelize.define('TransportStop', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  route_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(150), allowNull: false },
  pickup_time: { type: DataTypes.TIME, allowNull: true },
  drop_time: { type: DataTypes.TIME, allowNull: true },
  fare: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
}, { tableName: 'transport_stops', underscored: true });

module.exports = TransportStop;
