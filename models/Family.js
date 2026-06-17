'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Family = sequelize.define('Family', {
  id:              { type: DataTypes.INTEGER,      autoIncrement: true, primaryKey: true },
  school_id:       { type: DataTypes.INTEGER,      allowNull: false },
  user_id:         { type: DataTypes.INTEGER,      allowNull: true },
  family_name:     { type: DataTypes.STRING(150),  allowNull: false },
  primary_contact: { type: DataTypes.STRING(150),  allowNull: false },
  phone:           { type: DataTypes.STRING(20),   allowNull: false },
  email:           { type: DataTypes.STRING(150),  allowNull: true },
}, { tableName: 'families', underscored: true });

module.exports = Family;
