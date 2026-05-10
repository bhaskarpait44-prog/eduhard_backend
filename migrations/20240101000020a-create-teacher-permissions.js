'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('teacher_permissions', {
      id: {
        type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true,
      },
      teacher_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'teachers', key: 'id' },
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

    await queryInterface.addIndex('teacher_permissions', ['teacher_id', 'permission_id'], {
      name   : 'idx_teacher_permissions_unique',
      unique : true,
    });
    await queryInterface.addIndex('teacher_permissions', ['teacher_id'], {
      name: 'idx_teacher_permissions_teacher',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('teacher_permissions');
  },
};