'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AlumniProfile = sequelize.define('AlumniProfile', {
  id:                     { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id:             { type: DataTypes.INTEGER, allowNull: false, unique: true },
  school_id:              { type: DataTypes.INTEGER, allowNull: false },
  current_occupation:     { type: DataTypes.ENUM('employed', 'self_employed', 'higher_studies', 'unemployed', 'other'), allowNull: true },
  company_or_institution: { type: DataTypes.STRING(200), allowNull: true },
  job_title:              { type: DataTypes.STRING(150), allowNull: true },
  industry:               { type: DataTypes.STRING(100), allowNull: true },
  higher_edu_course:      { type: DataTypes.STRING(150), allowNull: true },
  higher_edu_institution: { type: DataTypes.STRING(200), allowNull: true },
  higher_edu_year:        { type: DataTypes.INTEGER, allowNull: true },
  contact_email:          { type: DataTypes.STRING(150), allowNull: true },
  contact_phone:          { type: DataTypes.STRING(20), allowNull: true },
  current_city:           { type: DataTypes.STRING(100), allowNull: true },
  current_state:          { type: DataTypes.STRING(100), allowNull: true },
  current_country:        { type: DataTypes.STRING(100), allowNull: true, defaultValue: 'India' },
  linkedin_url:           { type: DataTypes.STRING(300), allowNull: true },
  is_mentor_volunteer:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  testimonial:            { type: DataTypes.TEXT, allowNull: true },
  is_testimonial_public:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  admin_notes:            { type: DataTypes.TEXT, allowNull: true },
  profile_updated_at:     { type: DataTypes.DATE, allowNull: true },
  created_by:             { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'alumni_profiles',
  underscored: true,
});

module.exports = AlumniProfile;
