'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/database');

const Subject = sequelize.define('Subject', {
  id                      : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  class_id                : { type: DataTypes.INTEGER, allowNull: false },
  name                    : { type: DataTypes.STRING(150), allowNull: false },
  code                    : { type: DataTypes.STRING(30), allowNull: false },
  subject_type            : { type: DataTypes.ENUM('theory', 'practical', 'both'), allowNull: false, defaultValue: 'theory' },
  is_core                 : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  theory_total_marks      : { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  theory_passing_marks    : { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  practical_total_marks   : { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  practical_passing_marks : { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  combined_total_marks    : { type: DataTypes.DECIMAL(6, 2), allowNull: false },
  combined_passing_marks  : { type: DataTypes.DECIMAL(6, 2), allowNull: false },
  total_marks             : {
    type: DataTypes.VIRTUAL(DataTypes.DECIMAL(6, 2)),
    get() {
      return this.getDataValue('combined_total_marks');
    },
  },
  passing_marks           : {
    type: DataTypes.VIRTUAL(DataTypes.DECIMAL(6, 2)),
    get() {
      return this.getDataValue('combined_passing_marks');
    },
  },
  order_number            : { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  description             : { type: DataTypes.TEXT, allowNull: true },
  is_active               : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  is_deleted              : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  created_by              : { type: DataTypes.INTEGER, allowNull: true },
  updated_by              : { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName   : 'subjects',
  underscored : true,
  defaultScope: { where: { is_deleted: false } },
});

module.exports = Subject;
