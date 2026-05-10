'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add columns to students table
    await queryInterface.addColumn('students', 'status', {
      type: Sequelize.ENUM('active', 'left', 'graduated'),
      defaultValue: 'active',
      allowNull: false,
    });

    await queryInterface.addColumn('students', 'left_date', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    await queryInterface.addColumn('students', 'leaving_reason', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addColumn('students', 'leaving_remarks', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('students', 'status');
    await queryInterface.removeColumn('students', 'left_date');
    await queryInterface.removeColumn('students', 'leaving_reason');
    await queryInterface.removeColumn('students', 'leaving_remarks');
    
    // Note: To truly undo ENUM addition in some dialects (like Postgres), 
    // you might need to drop the type manually, but removing the column is usually enough for Sequelize.
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_students_status";');
    }
  },
};
