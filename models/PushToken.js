'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PushToken = sequelize.define('PushToken', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  teacher_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  token: {
    type: DataTypes.STRING(500),
    allowNull: false,
    unique: true,
  },
  platform: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  device_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  last_used: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'push_tokens',
  underscored: true,
});

module.exports = PushToken;
