'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Drop the old index which didn't check for status='active'
    await queryInterface.removeIndex('enrollments', 'idx_enrollments_student_session');

    // Create the new partial unique index
    await queryInterface.addIndex('enrollments', ['student_id', 'session_id'], {
      name: 'idx_enrollments_student_session',
      unique: true,
      where: {
        status: 'active'
      }
    });
  },

  async down(queryInterface, Sequelize) {
    // Drop the partial index
    await queryInterface.removeIndex('enrollments', 'idx_enrollments_student_session');

    // Recreate the old full unique index
    await queryInterface.addIndex('enrollments', ['student_id', 'session_id'], {
      name: 'idx_enrollments_student_session',
      unique: true
    });
  }
};
