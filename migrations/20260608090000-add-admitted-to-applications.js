'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add 'admitted' to enum status
    // Note: In Postgres, we can't easily drop enum values, but we can add them.
    await queryInterface.sequelize.query('ALTER TYPE "enum_applications_status" ADD VALUE IF NOT EXISTS \'admitted\';');

    await queryInterface.addColumn('applications', 'admitted_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addColumn('applications', 'admitted_at', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('applications', 'admitted_at');
    await queryInterface.removeColumn('applications', 'admitted_by');
    // Removing a value from an ENUM is complex and usually not recommended in migrations
    // because it can fail if data exists. We'll leave it in the type definition.
  }
};
