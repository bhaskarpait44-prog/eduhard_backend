'use strict';

/**
 * Migration: add_perm_city_to_profiles
 * 
 * Adds the missing perm_city column to student_profiles table.
 * This was missed in previous address-related migrations.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('student_profiles', 'perm_city', {
      type      : Sequelize.STRING(100),
      allowNull : true,
      after     : 'perm_district'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('student_profiles', 'perm_city');
  }
};
