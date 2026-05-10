'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuditLog = sequelize.define('AuditLog', {
  id          : { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  table_name  : { type: DataTypes.STRING(100), allowNull: false },
  record_id   : { type: DataTypes.INTEGER, allowNull: false },
  field_name  : { type: DataTypes.STRING(100), allowNull: false },
  old_value   : { type: DataTypes.TEXT, allowNull: true },
  new_value   : { type: DataTypes.TEXT, allowNull: true },
  changed_by  : { type: DataTypes.INTEGER, allowNull: true },
  reason      : { type: DataTypes.STRING(500), allowNull: true },
  ip_address  : { type: DataTypes.STRING(45), allowNull: true },
  device_info : { type: DataTypes.STRING(300), allowNull: true },
}, {
  tableName  : 'audit_logs',
  underscored: true,
  updatedAt  : false,

  // Enforce immutability at model level too — belt AND suspenders
  hooks: {
    beforeUpdate: () => { throw new Error('audit_logs records cannot be modified.'); },
    beforeDestroy: () => { throw new Error('audit_logs records cannot be deleted.'); },
  },
});

module.exports = AuditLog;