'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('bulk_import_logs', {
      id: {
        type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true,
      },
      school_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'schools', key: 'id' },
      },
      import_type: {
        type: Sequelize.ENUM('users', 'students', 'fees'),
        allowNull: false,
      },
      file_name: {
        type: Sequelize.STRING(255), allowNull: true,
      },
      total_rows: {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 0,
      },
      success_count: {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 0,
      },
      failed_count: {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 0,
      },
      error_details: {
        type: Sequelize.JSONB, allowNull: true,
        comment: 'Array of { row, field, error } objects',
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
        allowNull: false, defaultValue: 'pending',
      },
      imported_by: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      created_at: {
        type: Sequelize.DATE, allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE, allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('bulk_import_logs', ['school_id', 'created_at'], {
      name: 'idx_bulk_import_school',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('bulk_import_logs');
  },
};