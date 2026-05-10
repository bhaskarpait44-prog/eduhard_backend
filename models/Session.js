'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Session = sequelize.define('Session', {
  id         : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id  : { type: DataTypes.INTEGER, allowNull: false },
  name       : { type: DataTypes.STRING(20), allowNull: false },
  start_date : { type: DataTypes.DATEONLY, allowNull: false },
  end_date   : { type: DataTypes.DATEONLY, allowNull: false },
  status     : {
    type         : DataTypes.ENUM('upcoming', 'active', 'locked', 'closed', 'archived'),
    allowNull    : false,
    defaultValue : 'upcoming',
  },
  is_current : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  created_by : { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName  : 'sessions',
  underscored: true,
});

module.exports = Session;