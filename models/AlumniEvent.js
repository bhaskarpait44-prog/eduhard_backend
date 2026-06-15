'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AlumniEvent = sequelize.define('AlumniEvent', {
  id:          { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id:   { type: DataTypes.INTEGER, allowNull: false },
  title:       { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  event_date:  { type: DataTypes.DATEONLY, allowNull: false },
  event_time:  { type: DataTypes.STRING(10), allowNull: true },
  venue:       { type: DataTypes.STRING(300), allowNull: true },
  type:        { type: DataTypes.ENUM('reunion', 'seminar', 'felicitation', 'networking', 'other'), allowNull: false, defaultValue: 'other' },
  status:      { type: DataTypes.ENUM('upcoming', 'completed', 'cancelled'), allowNull: false, defaultValue: 'upcoming' },
  created_by:  { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'alumni_events',
  underscored: true,
});

module.exports = AlumniEvent;
