'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SessionWorkingDay = sequelize.define('SessionWorkingDay', {
  id         : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  session_id : { type: DataTypes.INTEGER, allowNull: false },
  monday     : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  tuesday    : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  wednesday  : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  thursday   : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  friday     : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  saturday   : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  sunday     : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName  : 'session_working_days',
  underscored: true,
  timestamps : false,   // No created_at/updated_at on this table by design
});

module.exports = SessionWorkingDay;