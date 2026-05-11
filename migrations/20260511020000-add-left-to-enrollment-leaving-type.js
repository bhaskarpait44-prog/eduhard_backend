'use strict';

/**
 * Adds 'left' to the enum_enrollments_leaving_type ENUM.
 * This is necessary because studentLeavingController uses 'left' when marking a student as left,
 * but this value was missing from the initial ENUM definition.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === 'postgres') {
      // Postgres-specific way to add a value to an existing ENUM type
      // Using 'IF NOT EXISTS' to make the migration idempotent
      await queryInterface.sequelize.query('ALTER TYPE "enum_enrollments_leaving_type" ADD VALUE IF NOT EXISTS \'left\';');
    } else {
      // For MySQL/MariaDB/SQLite/MSSQL, changeColumn usually works fine
      await queryInterface.changeColumn('enrollments', 'leaving_type', {
        type: Sequelize.ENUM('promoted', 'failed', 'transfer_out', 'withdrawn', 'graduated', 'expelled', 'left'),
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Removing an ENUM value in Postgres is complex (requires recreating the type).
    // Usually, we don't bother for simple value additions unless strictly necessary.
    // For other dialects, we can revert the changeColumn.
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') {
      await queryInterface.changeColumn('enrollments', 'leaving_type', {
        type: Sequelize.ENUM('promoted', 'failed', 'transfer_out', 'withdrawn', 'graduated', 'expelled'),
        allowNull: true,
      });
    }
  }
};
