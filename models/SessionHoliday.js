'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SessionHoliday = sequelize.define('SessionHoliday', {
  id           : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  session_id   : { type: DataTypes.INTEGER, allowNull: false },
  holiday_date : { type: DataTypes.DATEONLY, allowNull: false },
  name         : { type: DataTypes.STRING(150), allowNull: false },
  type         : { type: DataTypes.ENUM('national', 'regional', 'school'), allowNull: false },
  added_by     : { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName  : 'session_holidays',
  underscored: true,
  updatedAt  : false,   // Only created_at, no updated_at on holidays
});

module.exports = SessionHoliday;