'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('permissions', {
      id: {
        type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(100), allowNull: false, unique: true,
        comment: 'Dot notation: fees.view, students.create, etc.',
      },
      display_name: {
        type: Sequelize.STRING(150), allowNull: false,
        comment: 'Human readable: View Fees, Create Students',
      },
      category: {
        type: Sequelize.STRING(50), allowNull: false,
        comment: 'fees, students, attendance, results, classes, reports, users, audit, notices',
      },
      description: {
        type: Sequelize.TEXT, allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE, allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('permissions', ['category'], {
      name: 'idx_permissions_category',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('permissions');
  },
};