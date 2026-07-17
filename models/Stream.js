'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/database');

const Stream = sequelize.define('Stream', {
  id           : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id    : { type: DataTypes.INTEGER, allowNull: false },
  name         : { type: DataTypes.STRING(50), allowNull: false },
}, {
  tableName   : 'streams',
  underscored : true,
});

module.exports = Stream;
