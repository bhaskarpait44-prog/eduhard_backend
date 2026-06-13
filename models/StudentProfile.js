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
  parent_email      : { type: DataTypes.STRING(150), allowNull: true },
  emergency_contact : { type: DataTypes.STRING(20), allowNull: true },
  
  // SVA Expansion
  village              : { type: DataTypes.STRING(150), allowNull: true },
  police_station       : { type: DataTypes.STRING(150), allowNull: true },
  post_office          : { type: DataTypes.STRING(150), allowNull: true },
  district             : { type: DataTypes.STRING(100), allowNull: true },
  whatsapp_no          : { type: DataTypes.STRING(20), allowNull: true },
  nationality          : { type: DataTypes.STRING(50), allowNull: true, defaultValue: 'Indian' },
  religion             : { type: DataTypes.STRING(50), allowNull: true },
  caste                : { type: DataTypes.ENUM('OBC', 'ST', 'SC', 'Gen'), allowNull: true },
  mother_tongue        : { type: DataTypes.STRING(50), allowNull: true },
  identification_marks : { type: DataTypes.TEXT, allowNull: true },
  is_hostel            : { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
  medium               : { type: DataTypes.ENUM('English', 'Assamese'), allowNull: true },
  pen_no               : { type: DataTypes.STRING(50), allowNull: true },
  apaar_id             : { type: DataTypes.STRING(50), allowNull: true },
  prev_attendance_days : { type: DataTypes.INTEGER, allowNull: true },
  distance_km          : { type: DataTypes.DECIMAL(5, 2), allowNull: true },

  father_qualification : { type: DataTypes.STRING(150), allowNull: true },
  father_aadhar        : { type: DataTypes.STRING(20), allowNull: true },
  father_annual_income : { type: DataTypes.STRING(50), allowNull: true },
  
  mother_qualification : { type: DataTypes.STRING(150), allowNull: true },
  mother_aadhar        : { type: DataTypes.STRING(20), allowNull: true },
  mother_annual_income : { type: DataTypes.STRING(50), allowNull: true },
  
  guardian_name           : { type: DataTypes.STRING(150), allowNull: true },
  guardian_relation       : { type: DataTypes.STRING(50), allowNull: true },
  guardian_phone          : { type: DataTypes.STRING(20), allowNull: true },
  guardian_occupation     : { type: DataTypes.STRING(150), allowNull: true },
  guardian_qualification  : { type: DataTypes.STRING(150), allowNull: true },
  guardian_aadhar         : { type: DataTypes.STRING(20), allowNull: true },
  guardian_annual_income  : { type: DataTypes.STRING(50), allowNull: true },

  blood_group       : {
    type      : DataTypes.ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown'),
    allowNull : true,
  },
  medical_notes     : { type: DataTypes.TEXT, allowNull: true },
  photo_path        : { type: DataTypes.STRING(500), allowNull: true },

  // Permanent Address
  is_permanent_same    : { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
  perm_address         : { type: DataTypes.TEXT, allowNull: true },
  perm_village         : { type: DataTypes.STRING(150), allowNull: true },
  perm_police_station  : { type: DataTypes.STRING(150), allowNull: true },
  perm_post_office     : { type: DataTypes.STRING(150), allowNull: true },
  perm_district        : { type: DataTypes.STRING(100), allowNull: true },
  perm_city            : { type: DataTypes.STRING(100), allowNull: true },
  perm_state           : { type: DataTypes.STRING(100), allowNull: true },
  perm_pincode         : { type: DataTypes.STRING(10), allowNull: true },

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
        'mother_name','mother_phone','mother_email','parent_email',
        'emergency_contact','blood_group','medical_notes',
        'photo_path','valid_from','student_id',
        'village', 'police_station', 'post_office', 'district', 'whatsapp_no',
        'nationality', 'religion', 'caste', 'mother_tongue', 'identification_marks',
        'is_hostel', 'medium', 'pen_no', 'apaar_id', 'prev_attendance_days', 'distance_km',
        'father_qualification', 'father_aadhar', 'father_annual_income',
        'mother_qualification', 'mother_aadhar', 'mother_annual_income',
        'guardian_name', 'guardian_relation', 'guardian_phone', 'guardian_occupation',
        'guardian_qualification', 'guardian_aadhar', 'guardian_annual_income',
        'is_permanent_same', 'perm_address', 'perm_village', 'perm_police_station', 'perm_post_office', 'perm_district', 'perm_city', 'perm_state', 'perm_pincode'
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