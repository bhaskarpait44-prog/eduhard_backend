'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/database');

const Section = sequelize.define('Section', {
  id         : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  class_id   : { type: DataTypes.INTEGER, allowNull: false },
  name       : { type: DataTypes.STRING(10), allowNull: false },
  capacity   : { type: DataTypes.INTEGER, allowNull: false, defaultValue: 40 },
  class_teacher_id : { type: DataTypes.INTEGER, allowNull: true },
  is_active  : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  is_deleted : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName   : 'sections',
  underscored : true,
  defaultScope: { where: { is_deleted: false } },
});

module.exports = Section;