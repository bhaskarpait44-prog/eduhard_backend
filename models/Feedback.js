'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Feedback = sequelize.define('Feedback', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  type: { type: DataTypes.ENUM('feedback', 'complaint'), allowNull: false, defaultValue: 'feedback' },
  subject: { type: DataTypes.STRING(255), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.ENUM('open', 'in-progress', 'resolved'), allowNull: false, defaultValue: 'open' },
  admin_reply: { type: DataTypes.TEXT, allowNull: true },
  replied_by: { type: DataTypes.INTEGER, allowNull: true },
  replied_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'feedback', underscored: true });

module.exports = Feedback;
