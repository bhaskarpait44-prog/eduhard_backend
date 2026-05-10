'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentAchievement = sequelize.define('StudentAchievement', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  achievement_type: {
    type: DataTypes.ENUM(
      'perfect_attendance',
      'top_performer',
      'improvement',
      'attendance_streak',
      'homework_streak'
    ),
    allowNull: false,
  },
  earned_for: { type: DataTypes.STRING(150), allowNull: false },
  earned_at: { type: DataTypes.DATE, allowNull: false },
  session_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'student_achievements',
  underscored: true,
});

module.exports = StudentAchievement;
