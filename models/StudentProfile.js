'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StudentProfile = sequelize.define('StudentProfile', {
  id                : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id        : { type: DataTypes.INTEGER, allowNull: false },
  address           : { type: DataTypes.TEXT, allowNull: true },
  city              : { type: DataTypes.STRING(100), allowNull: true },
  state             : { type: DataTypes.STRING(100), allowNull: true },
  pincode           : { type: DataTypes.STRING(10), allowNull: true },
  phone             : { type: DataTypes.STRING(20), allowNull: true },
  email             : { type: DataTypes.STRING(150), allowNull: true },
  father_name       : { type: DataTypes.STRING(150), allowNull: true },
  father_phone      : { type: DataTypes.STRING(20), allowNull: true },
  father_occupation : { type: DataTypes.STRING(150), allowNull: true },
  mother_name       : { type: DataTypes.STRING(150), allowNull: true },
  mother_phone      : { type: DataTypes.STRING(20), allowNull: true },
  mother_email      : { type: DataTypes.STRING(150), allowNull: true },
  emergency_contact : { type: DataTypes.STRING(20), allowNull: true },
  blood_group       : {
    type      : DataTypes.ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown'),
    allowNull : true,
  },
  medical_notes     : { type: DataTypes.TEXT, allowNull: true },
  photo_path        : { type: DataTypes.STRING(500), allowNull: true },
  valid_from        : { type: DataTypes.DATEONLY, allowNull: false },
  valid_to          : { type: DataTypes.DATEONLY, allowNull: true },
  is_current        : { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  changed_by        : { type: DataTypes.INTEGER, allowNull: true },
  change_reason     : { type: DataTypes.STRING(500), allowNull: true },
}, {
  tableName   : 'student_profiles',
  underscored : true,
  updatedAt   : false,   // Rows are never updated (except closing columns via raw query)

  defaultScope: {
    // Default: always return the current version only
    where: { is_current: true },
  },

  scopes: {
    // StudentProfile.scope('allVersions').findAll({ where: { student_id: X } })
    allVersions : {},
    // StudentProfile.scope('asOf', '2024-08-01').findAll(...)
    asOf(date) {
      const { Op } = require('sequelize');
      return {
        where: {
          valid_from : { [Op.lte]: date },
          [Op.or]    : [
            { valid_to: null },
            { valid_to: { [Op.gte]: date } },
          ],
        },
      };
    },
  },

  hooks: {
    // Belt-and-suspenders: model layer also blocks direct updates to data columns
    beforeUpdate(instance) {
      const dataFields = [
        'address','city','state','pincode','phone','email',
        'father_name','father_phone','father_occupation',
        'mother_name','mother_phone','mother_email',
        'emergency_contact','blood_group','medical_notes',
        'photo_path','valid_from','student_id',
      ];
      const changed = dataFields.filter(f => instance.changed(f));
      if (changed.length > 0) {
        throw new Error(
          `student_profiles data columns are immutable: [${changed.join(', ')}]. ` +
          `Use profileVersioning.update() to create a new version.`
        );
      }
    },
    beforeDestroy() {
      throw new Error('student_profiles rows cannot be deleted.');
    },
  },
});

module.exports = StudentProfile;