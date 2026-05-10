'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Attendance = sequelize.define('Attendance', {
  id            : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  enrollment_id : { type: DataTypes.INTEGER, allowNull: false },
  date          : { type: DataTypes.DATEONLY, allowNull: false },
  status: {
    type      : DataTypes.ENUM('present', 'absent', 'late', 'half_day', 'holiday'),
    allowNull : false,
  },
  method: {
    type      : DataTypes.ENUM('biometric', 'manual', 'auto'),
    allowNull : false,
  },
  marked_by       : { type: DataTypes.INTEGER, allowNull: true },
  marked_at       : { type: DataTypes.DATE, allowNull: false },
  override_reason : { type: DataTypes.STRING(500), allowNull: true },
}, {
  tableName   : 'attendance',
  underscored : true,

  validate: {
    // override_reason required when status is being changed after initial mark
    overrideReasonConsistency() {
      // Enforced in service layer — model records the rule as documentation
    },
  },
});

module.exports = Attendance;