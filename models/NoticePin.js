'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const NoticePin = sequelize.define('NoticePin', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  notice_id: { type: DataTypes.INTEGER, allowNull: false },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  pinned_at: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'notice_pins',
  underscored: true,
});

module.exports = NoticePin;
