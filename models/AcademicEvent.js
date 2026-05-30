'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AcademicEvent = sequelize.define('AcademicEvent', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  school_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  session_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  event_type: {
    type: DataTypes.ENUM('exam', 'holiday', 'fee_deadline', 'meeting', 'sports', 'cultural', 'result', 'other'),
    allowNull: false
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  start_time: {
    type: DataTypes.TIME,
    allowNull: true
  },
  end_time: {
    type: DataTypes.TIME,
    allowNull: true
  },
  is_all_day: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  audience: {
    type: DataTypes.ENUM('everyone', 'students', 'teachers', 'parents', 'staff'),
    allowNull: false,
    defaultValue: 'everyone'
  },
  target_class_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  color: {
    type: DataTypes.STRING(7),
    allowNull: true
  },
  is_published: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  notify_on_publish: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'academic_events',
  underscored: true
});

module.exports = AcademicEvent;
