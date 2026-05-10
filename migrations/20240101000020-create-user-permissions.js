'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_permissions', {
      id: {
        type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true,
      },
      user_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      permission_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'permissions', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      granted_by: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      granted_at: {
        type: Sequelize.DATE, allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('user_permissions', ['user_id', 'permission_id'], {
      name   : 'idx_user_permissions_unique',
      unique : true,
    });
    await queryInterface.addIndex('user_permissions', ['user_id'], {
      name: 'idx_user_permissions_user',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_permissions');
  },
};