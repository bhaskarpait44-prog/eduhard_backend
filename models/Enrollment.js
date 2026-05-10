'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Enrollment = sequelize.define('Enrollment', {
  id                     : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id             : { type: DataTypes.INTEGER, allowNull: false },
  session_id             : { type: DataTypes.INTEGER, allowNull: false },
  class_id               : { type: DataTypes.INTEGER, allowNull: false },
  section_id             : { type: DataTypes.INTEGER, allowNull: false },
  stream                 : { type: DataTypes.STRING(20), allowNull: true },
  roll_number            : { type: DataTypes.STRING(20), allowNull: true },
  joined_date            : { type: DataTypes.DATEONLY, allowNull: false },
  joining_type: {
    type      : DataTypes.ENUM('fresh', 'promoted', 'failed', 'transfer_in', 'rejoined'),
    allowNull : false,
  },
  left_date              : { type: DataTypes.DATEONLY, allowNull: true },
  leaving_type: {
    type      : DataTypes.ENUM('promoted', 'failed', 'transfer_out', 'withdrawn', 'graduated', 'expelled'),
    allowNull : true,
  },
  previous_enrollment_id : { type: DataTypes.INTEGER, allowNull: true },
  status: {
    type         : DataTypes.ENUM('active', 'inactive'),
    allowNull    : false,
    defaultValue : 'active',
  },
}, {
  tableName   : 'enrollments',
  underscored : true,

  defaultScope: { where: { status: 'active' } },
  scopes: {
    all      : {},
    inactive : { where: { status: 'inactive' } },
    // Enrollment.scope('inSession', 5).findAll()
    inSession(sessionId) { return { where: { session_id: sessionId } }; },
  },

  validate: {
    // Ensure left_date and leaving_type are always set together
    leavingConsistency() {
      const hasDate = this.left_date !== null && this.left_date !== undefined;
      const hasType = this.leaving_type !== null && this.leaving_type !== undefined;
      if (hasDate !== hasType) {
        throw new Error('left_date and leaving_type must both be set or both be null.');
      }
    },
  },
});

module.exports = Enrollment;
