'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('permission_templates', {
      id: {
        type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true,
      },
      school_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      name: {
        type: Sequelize.STRING(150), allowNull: false,
        comment: 'e.g. Full Accountant, Class Teacher',
      },
      target_role: {
        type: Sequelize.STRING(50), allowNull: false,
        comment: 'Role this template is designed for',
      },
      permission_names: {
        type     : Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
        comment  : 'JSON array of permission name strings',
      },
      is_system: {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
        comment: 'System templates cannot be deleted',
      },
      created_by: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
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

    await queryInterface.addIndex('permission_templates', ['school_id', 'name'], {
      name: 'idx_permission_templates_school_name',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('permission_templates');
  },
};