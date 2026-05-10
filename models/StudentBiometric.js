'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentBiometric = sequelize.define('StudentBiometric', {
  id             : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id     : { type: DataTypes.INTEGER, allowNull: false, unique: true },
  face_embedding : { type: DataTypes.JSON, allowNull: true },
  fingerprint_1  : { type: DataTypes.BLOB, allowNull: true },
  fingerprint_2  : { type: DataTypes.BLOB, allowNull: true },
  enrolled_at    : { type: DataTypes.DATE, allowNull: true },
  last_updated   : { type: DataTypes.DATE, allowNull: true },
  is_active      : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName  : 'student_biometrics',
  underscored: true,
  timestamps : false,
});

module.exports = StudentBiometric;