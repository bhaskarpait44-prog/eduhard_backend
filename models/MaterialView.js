'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MaterialView = sequelize.define('MaterialView', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  material_id: { type: DataTypes.INTEGER, allowNull: false },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  viewed_at: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'material_views',
  underscored: true,
});

module.exports = MaterialView;
